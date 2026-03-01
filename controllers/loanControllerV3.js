const mongoose = require('mongoose');
const LoanV3 = require('../models/LoanV3');
const PaymentV2 = require('../models/PaymentV2');
const Client = require('../models/Client');
const Wallet = require('../models/Wallet');
const Settings = require('../models/Settings');
const { generateScheduleV3 } = require('../engines/amortizationEngineV3');
const { calculatePenaltyV3 } = require('../engines/penaltyEngineV3');
const { distributePaymentV3, applyPaymentToLoanV3, validatePaymentAmountV3 } = require('../engines/paymentEngineV3');
const financeController = require('./financeController');

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CREATE LOAN
 * ═══════════════════════════════════════════════════════════════════════════
 */
exports.createLoan = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const {
            clientId,
            productId,
            amount,
            interestRateMonthly,
            duration,
            frequency,
            frequencyMode,
            lendingType,
            startDate,
            firstPaymentDate,
            penaltyConfig,
            gracePeriod,
            initialPaidInstallments,
            interestRate // fallback from frontend
        } = req.body;

        const effectiveRate = interestRateMonthly || interestRate;
        const parsedAmount = parseFloat(amount);
        const parsedRate = parseFloat(effectiveRate);
        const parsedDuration = parseInt(duration) || 0;

        // Get settings for working days
        const settings = await Settings.findOne({ businessId: req.user.businessId }).session(session);

        // Generate schedule V3
        const { schedule, summary } = generateScheduleV3({
            amount: parsedAmount,
            interestRateMonthly: parsedRate,
            duration: parsedDuration,
            frequency,
            frequencyMode,
            lendingType,
            startDate: startDate || new Date(),
            firstPaymentDate: firstPaymentDate || new Date()
        });

        // Extract wallet currency first
        const fundingWallet = await Wallet.findById(req.body.fundingWalletId).session(session);
        if (!fundingWallet) throw new Error('Cartera de fondeo no encontrada');

        // Create loan
        const newLoan = new LoanV3({
            clientId,
            businessId: req.user.businessId,
            productId,
            amount: parsedAmount,
            currency: fundingWallet.currency || 'DOP',
            currentCapital: parsedAmount,
            interestRateMonthly: parsedRate,
            interestRatePeriodic: 0, // Calculated in schedule generation
            lendingType,
            duration: parsedDuration,
            initialDuration: parsedDuration,
            frequency,
            frequencyMode,
            startDate: startDate || new Date(),
            firstPaymentDate: firstPaymentDate || new Date(),
            gracePeriod: gracePeriod || 0,
            initialPaidInstallments: initialPaidInstallments || 0,

            // FUNDING & ATTRIBUTION
            fundingWalletId: req.body.fundingWalletId,
            investorId: req.body.investorId,
            managerId: req.body.managerId,
            revenueShare: req.body.revenueShare,

            status: 'active', // Will be updated below
            penaltyConfig: penaltyConfig || {
                type: 'fixed',
                value: 0,
                gracePeriod: 0,
                periodMode: 'daily',
                applyPerInstallment: true,
                applyOncePerPeriod: false,
                applyOn: 'quota',
                maxPenalty: null,
                paidPenalty: 0
            },
            financialModel: {
                interestCalculationMode: 'simple',
                capitalAdvanceRule: 'after_interest',
                allowAdvancePayments: true,
                interestTotal: summary.interestTotal,
                interestPending: summary.interestTotal,
                interestPaid: 0
            },
            schedule: schedule,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        // ─────────────────────────────────────────────────────────────────────────
        // APPROVAL FLOW
        // ─────────────────────────────────────────────────────────────────────────

        // Safety check for Owner ID
        if (!fundingWallet.ownerId) {
            console.error("Critical: Wallet missing ownerId", fundingWallet);
            throw new Error(`La cartera "${fundingWallet.name}" no tiene un propietario asignado. Contacte a soporte.`);
        }

        const currentUserId = req.user ? (req.user._id || req.user.id) : null;

        if (!currentUserId) {
            console.error("Session Error: req.user", req.user);
            throw new Error("Error de sesión: Usuario no identificado (Token corrupto).");
        }

        const isOwner = fundingWallet.ownerId.toString() === currentUserId.toString();

        if (isOwner) {
            // AUTO-APPROVE
            newLoan.approvalStatus = 'approved';
            newLoan.status = 'active';

            // DEDUCT FUNDS NOW
            if (fundingWallet.balance < amount) {
                throw new Error('Fondos insuficientes en la cartera de fondeo');
            }
            fundingWallet.balance -= amount;
            await fundingWallet.save({ session });

            // Create Transaction Record
            const Transaction = require('../models/Transaction');
            await new Transaction({
                businessId: req.user.businessId,
                type: 'out_loan',
                category: 'Desembolso',
                amount: amount,
                currency: fundingWallet.currency || 'DOP',
                description: `Desembolso Préstamo V3 #${newLoan._id.toString().slice(-6)}`,
                loanV3: newLoan._id, // Notice: using loanV3 field if it exists or generic project?
                wallet: fundingWallet._id,
                client: clientId,
                date: new Date()
            }).save({ session });

        } else {
            // REQUIRE APPROVAL
            newLoan.approvalStatus = 'pending_approval';
            newLoan.status = 'pending_approval';

            // Create Approval Request
            const ApprovalRequest = require('../models/ApprovalRequest');
            const reqApproval = new ApprovalRequest({
                loanId: newLoan._id,
                requesterId: req.user._id,
                walletOwnerId: fundingWallet.ownerId,
                requestedAmount: amount,
                status: 'pending',
                businessId: req.user.businessId
            });
            await reqApproval.save({ session });
        }


        if (newLoan.status === 'active' && initialPaidInstallments > 0) {
            for (let i = 0; i < Math.min(initialPaidInstallments, newLoan.schedule.length); i++) {
                const inst = newLoan.schedule[i];
                inst.status = 'paid';
                inst.paidAmount = inst.amount;
                inst.interestPaid = inst.interestAmount;
                inst.capitalPaid = inst.principalAmount;
                inst.paidDate = new Date(inst.dueDate);
            }

            const paidCapital = newLoan.schedule.slice(0, initialPaidInstallments)
                .reduce((sum, inst) => sum + parseFloat(inst.principalAmount.toString() || 0), 0);

            newLoan.currentCapital -= paidCapital;
        }

        // Save loan
        await newLoan.save({ session });

        // Update client balance - ONLY IF APPROVED (Or wait?) 
        // Logic: We add balance immediately, if rejected we reverse? 
        // Better: Add balance usually signals debt. If pending, maybe don't add yet?
        // Current requirement implies standard flow but "pending". 
        // Let's add debt but blocked? 
        // Simplified: If pending, do NOT add to client balance yet to avoid confusion.

        if (newLoan.status === 'active') {
            const balanceToInc = lendingType === 'redito' ? amount : summary.totalToPay;
            await Client.findByIdAndUpdate(
                clientId,
                { $inc: { balance: balanceToInc } },
                { session }
            );
        }

        await session.commitTransaction();

        // Sincronizar balance dinámicamente
        if (newLoan.fundingWalletId) {
            await financeController.recalculateWalletBalance(newLoan.fundingWalletId);
        }

        res.status(201).json({
            success: true,
            loan: newLoan,
            summary,
            approvalPending: !isOwner
        });

    } catch (error) {
        await session.abortTransaction();
        console.error('Error creating loan:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        session.endSession();
    }
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GET ALL LOANS
 * ═══════════════════════════════════════════════════════════════════════════
 */
exports.getLoans = async (req, res) => {
    try {
        const loans = await LoanV3.find({ businessId: req.user.businessId })
            .populate('clientId', 'name cedula phone')
            .sort({ createdAt: -1 });

        const settings = await Settings.findOne({ businessId: req.user.businessId });

        // Enrich with calculated penalty V3
        const enrichedLoans = loans.map(loan => {
            const penaltyData = calculatePenaltyV3(loan, settings);
            const pendingPenalty = Math.max(0, penaltyData.totalPenalty - (parseFloat(loan.penaltyConfig.paidPenalty?.toString()) || 0));

            return {
                ...loan.toObject(),
                currentPenalty: pendingPenalty,
                penaltyPeriodsOverdue: penaltyData.periodsOverdue
            };
        });

        res.json(enrichedLoans);

    } catch (error) {
        console.error('Error fetching loans:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GET LOAN BY ID
 * ═══════════════════════════════════════════════════════════════════════════
 */
exports.getLoanById = async (req, res) => {
    try {
        const loan = await LoanV3.findById(req.params.id)
            .populate('clientId', 'name cedula phone');

        if (!loan) {
            return res.status(404).json({ error: 'Préstamo no encontrado' });
        }

        const settings = await Settings.findOne({ businessId: loan.businessId });
        const penaltyData = calculatePenaltyV3(loan, settings);
        const pendingPenalty = Math.max(0, penaltyData.totalPenalty - (parseFloat(loan.penaltyConfig.paidPenalty?.toString()) || 0));

        res.json({
            ...loan.toObject(),
            currentPenalty: pendingPenalty,
            penaltyBreakdown: penaltyData.breakdown
        });

    } catch (error) {
        console.error('Error fetching loan:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * REGISTER PAYMENT
 * ═══════════════════════════════════════════════════════════════════════════
 */
exports.registerPayment = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { amount, paymentMethod, walletId, notes, customDate } = req.body;
        const paymentDate = customDate ? new Date(customDate) : new Date();
        const loanId = req.params.id;

        const loan = await LoanV3.findById(loanId).session(session);
        if (!loan) throw new Error('Préstamo no encontrado');

        const client = await Client.findById(loan.clientId).session(session);

        // Cartera fallback: Body -> Loan -> Default
        let finalWalletId = walletId || loan.fundingWalletId;
        if (!finalWalletId) {
            const defaultWallet = await Wallet.findOne({ businessId: loan.businessId, isDefault: true }).session(session);
            if (defaultWallet) finalWalletId = defaultWallet._id;
        }

        const wallet = await Wallet.findById(finalWalletId).session(session);
        const settings = await Settings.findOne({ businessId: loan.businessId }).session(session);

        // Calculate current penalty USING paymentDate (for retroactive payments)
        const penaltyData = calculatePenaltyV3(loan, settings, paymentDate);

        // Validate payment
        const validation = validatePaymentAmountV3(loan, amount, penaltyData);
        if (!validation.valid) {
            throw new Error(validation.message);
        }

        // Distribute payment
        const distribution = distributePaymentV3(loan, amount, penaltyData);

        // Apply distribution to loan
        applyPaymentToLoanV3(loan, distribution);

        loan.markModified('schedule');
        loan.markModified('financialModel');
        loan.markModified('penaltyConfig');

        // FIX V3 MIGRATION: frequencyMode is sometimes saved as primitive 'standard', causing validation error
        if (loan.frequencyMode && typeof loan.frequencyMode === 'string') {
            loan.frequencyMode = {};
        }

        // Save loan
        await loan.save({ session });

        // ────────────────────────────────────────────────────────────────────
        // REGISTRO SIMPLE: Todo el pago va a la cartera seleccionada
        // (igual que en V1 — sin distribución automática entre carteras)
        // ────────────────────────────────────────────────────────────────────
        if (wallet) {
            wallet.balance += amount;
            await wallet.save({ session });
        }

        const Transaction = require('../models/Transaction');
        const receiptId = `REC-${Date.now().toString().slice(-6)}`;

        const paidQuotaNumbers = distribution.quotasPaid?.map(q => `#${q}`) || [];
        const descParts = [];
        if (distribution.appliedInterest > 0) descParts.push(`Interés: ${distribution.appliedInterest.toFixed(2)}`);
        if (distribution.appliedCapital > 0) descParts.push(`Capital: ${distribution.appliedCapital.toFixed(2)}`);
        if (distribution.appliedPenalty > 0) descParts.push(`Mora: ${distribution.appliedPenalty.toFixed(2)}`);

        await new Transaction({
            businessId: loan.businessId,
            type: 'in_payment',
            category: 'Pago Préstamo',
            currency: loan.currency || 'DOP',
            amount: amount,
            description: `Pago Préstamo | ${descParts.join(' | ')}`,
            loanV3: loan._id,
            wallet: finalWalletId,
            client: loan.clientId,
            receiptId,
            metadata: {
                loanId: loan._id,
                breakdown: {
                    appliedCapital: distribution.appliedCapital,
                    appliedToCapital: distribution.appliedCapital,
                    capital: distribution.appliedCapital,
                    appliedInterest: distribution.appliedInterest,
                    appliedToInterest: distribution.appliedInterest,
                    interest: distribution.appliedInterest,
                    appliedPenalty: distribution.appliedPenalty,
                    appliedToMora: distribution.appliedPenalty,
                    mora: distribution.appliedPenalty
                }
            },
            date: paymentDate
        }).save({ session });

        // Update client balance
        const balanceReduction = distribution.appliedInterest + distribution.appliedCapital + distribution.appliedPenalty;
        await Client.findByIdAndUpdate(
            loan.clientId,
            { $inc: { balance: -balanceReduction } },
            { session }
        );

        // Create payment record
        const payment = new PaymentV2({
            loanId: loan._id,
            date: paymentDate,
            amount,
            remainingPayment: 0,
            appliedPenalty: distribution.appliedPenalty,
            appliedInterest: distribution.appliedInterest,
            appliedCapital: distribution.appliedCapital,
            isAdvancePayment: false,
            paymentMethod: paymentMethod || 'cash',
            walletId: finalWalletId,
            userId: req.user.id || req.user._id,
            receiptId,
            notes: notes || '',
            metadata: {
                breakdown: {
                    appliedCapital: distribution.appliedCapital,
                    appliedInterest: distribution.appliedInterest,
                    appliedPenalty: distribution.appliedPenalty,
                    mora: distribution.appliedPenalty,
                    otherCharges: 0
                }
            },
            businessId: loan.businessId
        });

        await payment.save({ session });

        await session.commitTransaction();

        res.json({
            success: true,
            payment,
            distribution,
            newLoanStatus: {
                status: loan.status,
                currentCapital: loan.currentCapital,
                pendingPenalty: Math.max(0, penaltyData.totalPenalty - loan.penaltyConfig.paidPenalty)
            }
        });

    } catch (error) {
        await session.abortTransaction();
        console.error('Error registering payment:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally {
        session.endSession();
    }
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GET LOAN SCHEDULE
 * ═══════════════════════════════════════════════════════════════════════════
 */
exports.getLoanSchedule = async (req, res) => {
    try {
        const loan = await LoanV3.findById(req.params.id);

        if (!loan) {
            return res.status(404).json({ error: 'Préstamo no encontrado' });
        }

        res.json({
            schedule: loan.schedule,
            summary: {
                total: loan.schedule.length,
                paid: loan.schedule.filter(i => i.status === 'paid').length,
                partial: loan.schedule.filter(i => i.status === 'partial').length,
                pending: loan.schedule.filter(i => i.status === 'pending').length
            }
        });

    } catch (error) {
        console.error('Error fetching schedule:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PREVIEW LOAN
 * ═══════════════════════════════════════════════════════════════════════════
 */
exports.previewLoan = async (req, res) => {
    try {
        const {
            amount,
            interestRate, // Frontend sends 'interestRate' but engine expects 'interestRateMonthly'
            interestRateMonthly,
            duration,
            frequency,
            frequencyMode,
            lendingType,
            startDate,
            firstPaymentDate
        } = req.body;

        // Get settings for working days
        const settings = await Settings.findOne({ businessId: req.user.businessId });

        console.log("PREVIEW LOAN PARAMS:", {
            amount, interestRateMonthly, interestRate, duration, frequency, lendingType
        });

        const effectiveRate = interestRateMonthly || interestRate;

        // Generate schedule V3
        const { schedule, summary } = generateScheduleV3({
            amount: parseFloat(amount),
            interestRateMonthly: parseFloat(effectiveRate),
            duration: parseInt(duration),
            frequency,
            frequencyMode,
            lendingType,
            startDate: startDate || new Date(),
            firstPaymentDate: firstPaymentDate || new Date()
        });

        console.log("SCHEDULE GENERATED, FIRST ITEM:", schedule[0]);

        res.json({
            schedule,
            finalAmount: amount,
            finalRate: interestRateMonthly || interestRate,
            totalToPay: summary.totalToPay
        });

    } catch (error) {
        console.error('Error generating preview:', error);
        res.status(500).json({ error: error.message });
    }
};


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * APPROVE LOAN
 * ═══════════════════════════════════════════════════════════════════════════
 */
exports.approveLoan = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const loan = await LoanV3.findById(req.params.id).session(session);
        if (!loan) throw new Error("Préstamo no encontrado");

        if (loan.approvalStatus !== 'pending_approval') {
            throw new Error("El préstamo no está pendiente de aprobación");
        }

        const wallet = await Wallet.findById(loan.fundingWalletId).session(session);
        if (!wallet) throw new Error("Cartera de fondeo no encontrada");

        // Verify Ownership (Only Owner can approve)
        if (wallet.ownerId.toString() !== req.user._id.toString()) {
            // Optional: Allow Admin to approve everything?
            if (req.user.role !== 'admin') {
                throw new Error("No tienes permiso para aprobar este préstamo (No eres el dueño de la cartera)");
            }
        }

        // Deduct Funds
        if (wallet.balance < loan.amount) {
            throw new Error(`Fondos insuficientes en cartera ${wallet.name} para aprobar este préstamo.`);
        }

        wallet.balance -= loan.amount;
        await wallet.save({ session });

        // Update Loan
        loan.approvalStatus = 'approved';
        loan.status = 'active';
        await loan.save({ session });

        // Create Transaction
        const Transaction = require('../models/Transaction');
        await new Transaction({
            type: 'out_loan',
            amount: loan.amount,
            currency: loan.currency || 'DOP',
            category: 'Desembolso',
            description: `Préstamo #${loan._id.toString().slice(-6)} Aprobado`,
            client: loan.clientId,
            wallet: wallet._id,
            loanV3: loan._id,
            businessId: req.user.businessId,
            date: new Date()
        }).save({ session });

        // Notify Requestor
        const notificationController = require('./notificationController');
        try {
            // Find original approval request to get requesterId?
            // Or assume managerId creates it.
            const ApprovalRequest = require('../models/ApprovalRequest');
            const reqApproval = await ApprovalRequest.findOne({ loanId: loan._id });
            if (reqApproval) {
                reqApproval.status = 'approved';
                await reqApproval.save({ session });

                await notificationController.createNotification(
                    loan.businessId,
                    'loan_approved',
                    `Tu solicitud para el préstamo ${loan._id.toString().slice(-6)} ha sido APROBADA.`,
                    loan._id
                );
            }
        } catch (e) { }

        await session.commitTransaction();
        res.json({ success: true, message: "Préstamo aprobado exitosamente" });

    } catch (error) {
        await session.abortTransaction();
        res.status(500).json({ error: error.message });
    } finally {
        session.endSession();
    }
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * REJECT LOAN
 * ═══════════════════════════════════════════════════════════════════════════
 */
exports.rejectLoan = async (req, res) => {
    try {
        const loan = await LoanV3.findById(req.params.id);
        if (!loan) throw new Error("Préstamo no encontrado");

        if (loan.approvalStatus !== 'pending_approval') {
            throw new Error("El préstamo no está pendiente");
        }

        // Verify Permission (Owner or Admin or the Creator themselves can cancel?)
        // Let's allow Owner/Admin.
        // Also we don't need strict wallet check here since we are NOT touching funds.

        loan.approvalStatus = 'rejected';
        loan.status = 'rejected';
        await loan.save();

        // Notify
        // ... (Same logic to notify requester)

        res.json({ success: true, message: "Préstamo rechazado" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GET LOAN PAYMENTS
 * ═══════════════════════════════════════════════════════════════════════════
 */
exports.getLoanPayments = async (req, res) => {
    try {
        const payments = await PaymentV2.find({
            loanId: req.params.id,
            businessId: req.user.businessId
        }).populate('userId', 'name').sort({ date: -1 });

        res.json(payments);
    } catch (error) {
        console.error('Error fetching loan payments:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * APPLY PENALTY (Shift Schedule)
 * ═══════════════════════════════════════════════════════════════════════════
 */
exports.applyPenalty = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { id } = req.params;
        const { walletId, paymentMethod, notes, customDate } = req.body;
        const paymentDate = customDate ? new Date(customDate) : new Date();

        const loan = await LoanV3.findById(id).session(session);
        if (!loan) throw new Error("Préstamo no encontrado");

        // 1. Encontrar la primera cuota pendiente o parcial
        const currentQuotaIndex = loan.schedule.findIndex(q => q.status === 'pending' || q.status === 'partial');
        if (currentQuotaIndex === -1) throw new Error("No hay cuotas pendientes para aplicar penalidad");

        const currentQuota = loan.schedule[currentQuotaIndex];
        const amortizationEngineV3 = require('../engines/amortizationEngineV3');

        // 2. Calcular monto de la penalidad (Interés de la cuota actual)
        const rawInterestAmount = currentQuota.interestAmount != null ? currentQuota.interestAmount : currentQuota.interest;
        const rawPrincipalAmount = currentQuota.principalAmount != null ? currentQuota.principalAmount : currentQuota.capital;
        const penaltyAmount = (rawInterestAmount?.$numberDecimal) ? parseFloat(rawInterestAmount.$numberDecimal) : (parseFloat(rawInterestAmount) || 0);

        if (penaltyAmount <= 0) throw new Error("Esta cuota no tiene intereses pendientes para aplicar penalidad");

        // 3. Lógica de Desplazamiento (Shift)
        // Guardar montos originales para la nueva cuota final
        const originalPrincipal = rawPrincipalAmount;
        const originalInterest = rawInterestAmount;

        // CORRECCIÓN: Ajustar el monto de la cuota actual para que no duplique capital en los totales
        loan.schedule[currentQuotaIndex].principalAmount = mongoose.Types.Decimal128.fromString("0.00");
        loan.schedule[currentQuotaIndex].amount = mongoose.Types.Decimal128.fromString(penaltyAmount.toFixed(2));
        loan.schedule[currentQuotaIndex].interestAmount = mongoose.Types.Decimal128.fromString(penaltyAmount.toFixed(2));
        loan.schedule[currentQuotaIndex].paidAmount = mongoose.Types.Decimal128.fromString(penaltyAmount.toFixed(2));
        loan.schedule[currentQuotaIndex].interestPaid = mongoose.Types.Decimal128.fromString(penaltyAmount.toFixed(2));
        loan.schedule[currentQuotaIndex].status = 'paid';
        loan.schedule[currentQuotaIndex].paidDate = paymentDate;
        loan.schedule[currentQuotaIndex].notes = (loan.schedule[currentQuotaIndex].notes || "") + " [Penalidad Aplicada]";

        // 4. Rodar fechas de las cuotas futuras
        // Desde la cuota actual + 1 en adelante, sumamos un periodo
        for (let i = currentQuotaIndex + 1; i < loan.schedule.length; i++) {
            const quota = loan.schedule[i];
            quota.dueDate = amortizationEngineV3.getNextDueDate(quota.dueDate, loan.frequency);
        }

        // 5. Agregar nueva cuota al final
        const lastQuota = loan.schedule[loan.schedule.length - 1];
        const newDueDate = amortizationEngineV3.getNextDueDate(lastQuota.dueDate, loan.frequency);

        loan.schedule.push({
            number: loan.schedule.length + 1,
            dueDate: newDueDate,
            amount: mongoose.Types.Decimal128.fromString((parseFloat(originalPrincipal.toString()) + parseFloat(originalInterest.toString())).toFixed(2)),
            principalAmount: originalPrincipal,
            interestAmount: originalInterest,
            balance: lastQuota.balance, // El balance se mantiene igual ya que no se amortizó capital
            status: 'pending',
            daysOfGrace: 0
        });

        // 6. Actualizar totales del préstamo (el interés total sube por la penalidad)
        loan.financialModel.interestTotal += penaltyAmount;
        loan.financialModel.interestPaid += penaltyAmount;
        loan.duration += 1;

        loan.markModified('schedule');
        loan.markModified('financialModel');

        if (loan.frequencyMode && typeof loan.frequencyMode === 'string') {
            loan.frequencyMode = {};
        }

        await loan.save({ session });

        // 7. Registrar Finanzas
        let finalWalletId = walletId || loan.fundingWalletId;
        if (!finalWalletId) {
            const defaultWallet = await Wallet.findOne({ businessId: loan.businessId, isDefault: true }).session(session);
            if (defaultWallet) finalWalletId = defaultWallet._id;
        }

        const wallet = await Wallet.findById(finalWalletId).session(session);
        if (wallet) {
            wallet.balance += penaltyAmount;
            await wallet.save({ session });
        }

        const Transaction = require('../models/Transaction');
        const tx = await new Transaction({
            businessId: loan.businessId,
            type: 'in_payment',
            category: 'Otros Cargos',
            currency: loan.currency || 'DOP',
            amount: penaltyAmount,
            description: `Pago Penalidad (Gana Tiempo) - Préstamo #${loan._id.toString().slice(-6)}`,
            loanV3: loan._id,
            wallet: finalWalletId,
            client: loan.clientId,
            date: paymentDate,
            metadata: {
                concept: 'penalty_shift',
                originalQuotaNumber: currentQuota.number,
                breakdown: {
                    appliedPenalty: penaltyAmount,
                    appliedToMora: penaltyAmount,
                    mora: penaltyAmount,
                    appliedInterest: 0,
                    appliedCapital: 0
                }
            }
        }).save({ session });

        // 8. Crear Registro de Pago
        const receiptId = `REC-PEN-${Date.now().toString().slice(-6)}`;
        const PaymentV2 = require('../models/PaymentV2');
        const payment = new PaymentV2({
            loanId: loan._id,
            date: new Date(),
            amount: penaltyAmount,
            remainingPayment: 0,
            appliedPenalty: penaltyAmount,
            appliedInterest: 0,
            appliedCapital: 0,
            otherCharges: penaltyAmount,
            paymentMethod: paymentMethod || 'cash',
            walletId: finalWalletId,
            userId: req.user.id || req.user._id,
            receiptId,
            notes: (notes || "") + " [Penalidad Aplicada]",
            metadata: {
                concept: 'penalty_shift',
                breakdown: {
                    appliedPenalty: penaltyAmount,
                    mora: penaltyAmount,
                    appliedInterest: 0,
                    appliedCapital: 0,
                    otherCharges: penaltyAmount
                }
            },
            businessId: loan.businessId
        });
        await payment.save({ session });

        // 9. Actualizar balance del cliente (Sincronización)
        const Client = require('../models/Client');
        await Client.findByIdAndUpdate(
            loan.clientId,
            { $inc: { balance: -penaltyAmount } },
            { session }
        );

        await session.commitTransaction();
        res.json({ success: true, message: "Penalidad aplicada y calendario actualizado", payment });

    } catch (error) {
        await session.abortTransaction();
        console.error('Error applying penalty:', error);
        res.status(500).json({ error: error.message });
    } finally {
        session.endSession();
    }
};

module.exports = exports;

/**
 * DELETE PAYMENT V3
 * Revierte un pago de PaymentV2 en un préstamo V3 restaurando el calendario y el balance
 */
exports.deletePaymentV3 = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { id: loanId, paymentId } = req.params;
        const PaymentV2 = require('../models/PaymentV2');
        const Transaction = require('../models/Transaction');

        const payment = await PaymentV2.findById(paymentId).session(session);
        if (!payment) throw new Error('Pago no encontrado');

        const loan = await LoanV3.findById(loanId).session(session);
        if (!loan) throw new Error('Préstamo no encontrado');

        if (loan.businessId.toString() !== req.user.businessId.toString()) {
            throw new Error('Acceso denegado');
        }

        const { appliedCapital, appliedInterest, appliedPenalty, amount, walletId } = payment;
        const getD = (v) => v && v.$numberDecimal ? parseFloat(v.$numberDecimal) : parseFloat(v || 0);

        // --- LÓGICA ESPECIAL: REVERTIR GANA TIEMPO (SHIFT) ---
        const isPenaltyShift = payment.metadata?.concept === 'penalty_shift' || (payment.notes && payment.notes.includes("[Penalidad Aplicada]"));

        if (isPenaltyShift) {
            const amortizationEngineV3 = require('../engines/amortizationEngineV3');

            // 1. Encontrar la cuota que fue penalizada
            // Coincidencia estricta: Nota + Pagado + Monto exacto
            let penalizedQuotaIndex = loan.schedule.findIndex(q =>
                (q.notes && q.notes.includes("[Penalidad Aplicada]")) &&
                q.status === 'paid' &&
                Math.abs(getD(q.paidAmount) - amount) < 0.05
            );

            // Fallback 1: Buscar por nota y monto (independiente del estado)
            if (penalizedQuotaIndex === -1) {
                penalizedQuotaIndex = loan.schedule.findIndex(q =>
                    (q.notes && q.notes.includes("[Penalidad Aplicada]")) &&
                    Math.abs(getD(q.amount) - amount) < 0.05
                );
            }

            // Fallback 2: Buscar cualquier cuota que tenga la marca de penalidad
            if (penalizedQuotaIndex === -1) {
                penalizedQuotaIndex = loan.schedule.findIndex(q =>
                    (q.notes && q.notes.includes("[Penalidad Aplicada]"))
                );
            }

            if (penalizedQuotaIndex !== -1) {
                // 2. Recuperar montos originales de la última cuota (la que se agregó al final)
                const lastQuota = loan.schedule[loan.schedule.length - 1];

                loan.schedule[penalizedQuotaIndex].principalAmount = lastQuota.principalAmount;
                loan.schedule[penalizedQuotaIndex].interestAmount = lastQuota.interestAmount;
                loan.schedule[penalizedQuotaIndex].amount = lastQuota.amount;
                loan.schedule[penalizedQuotaIndex].status = 'pending';
                loan.schedule[penalizedQuotaIndex].paidAmount = mongoose.Types.Decimal128.fromString("0.00");
                loan.schedule[penalizedQuotaIndex].interestPaid = mongoose.Types.Decimal128.fromString("0.00");
                loan.schedule[penalizedQuotaIndex].paidDate = null;
                // Limpiar la nota de penalidad de forma conservadora
                if (loan.schedule[penalizedQuotaIndex].notes) {
                    loan.schedule[penalizedQuotaIndex].notes = loan.schedule[penalizedQuotaIndex].notes.replace(" [Penalidad Aplicada]", "").trim();
                }

                // 3. Eliminar la última cuota (que era el desplazamiento)
                loan.schedule.pop();

                // 4. Desplazar fechas hacia atrás
                for (let i = penalizedQuotaIndex + 1; i < loan.schedule.length; i++) {
                    loan.schedule[i].dueDate = amortizationEngineV3.getPrevDueDate(loan.schedule[i].dueDate, loan.frequency);
                }

                // 5. Ajustar métricas financieras
                loan.duration = Math.max(0, loan.duration - 1);
                loan.financialModel = loan.financialModel || {};
                loan.financialModel.interestTotal = Math.max(0, (loan.financialModel.interestTotal || 0) - amount);
                loan.financialModel.interestPaid = Math.max(0, (loan.financialModel.interestPaid || 0) - amount);
            }
        } else {
            // --- LÓGICA REGULAR: REVERTIR PAGOS DE CAPITAL/INTERÉS ---
            let remainingToRevert = amount;
            for (let i = loan.schedule.length - 1; i >= 0 && remainingToRevert > 0; i--) {
                const q = loan.schedule[i];
                const paidOnThisQuota = getD(q.paidAmount);
                if (paidOnThisQuota <= 0) continue;

                const revertAmt = Math.min(paidOnThisQuota, remainingToRevert);
                const newPaid = Math.max(0, paidOnThisQuota - revertAmt);
                loan.schedule[i].paidAmount = mongoose.Types.Decimal128.fromString(newPaid.toFixed(2));

                if (newPaid <= 0) {
                    loan.schedule[i].status = 'pending';
                    loan.schedule[i].paidDate = null;
                    loan.schedule[i].capitalPaid = mongoose.Types.Decimal128.fromString('0.00');
                    loan.schedule[i].interestPaid = mongoose.Types.Decimal128.fromString('0.00');
                } else {
                    loan.schedule[i].status = 'partial';
                }
                remainingToRevert -= revertAmt;
            }

            // Restaurar métricas financieras para pagos regulares
            loan.financialModel = loan.financialModel || {};
            loan.financialModel.interestPaid = Math.max(0, getD(loan.financialModel.interestPaid) - appliedInterest);
            loan.currentCapital = Math.min(getD(loan.amount), getD(loan.currentCapital) + appliedCapital);
        }

        if (loan.penaltyConfig) {
            loan.penaltyConfig.paidPenalty = Math.max(0, getD(loan.penaltyConfig.paidPenalty) - appliedPenalty);
        }

        loan.markModified('schedule');
        loan.markModified('financialModel');
        loan.markModified('penaltyConfig');
        await loan.save({ session });

        // Ajustar balance de cartera
        if (walletId) {
            const wallet = await Wallet.findById(walletId).session(session);
            if (wallet) {
                wallet.balance = Math.max(0, wallet.balance - amount);
                await wallet.save({ session });
            }
        }

        // Actualizar balance del cliente
        await Client.findByIdAndUpdate(
            loan.clientId,
            { $inc: { balance: amount } },
            { session }
        );

        // Eliminar la Transaction relacionada (si existe)
        await Transaction.deleteMany({ loanV3: loanId, receiptId: payment.receiptId }).session(session);

        // Eliminar el PaymentV2
        await PaymentV2.findByIdAndDelete(paymentId).session(session);

        await session.commitTransaction();
        res.json({ success: true, message: 'Pago eliminado y préstamo restaurado correctamente' });

    } catch (error) {
        await session.abortTransaction();
        console.error('Error deleting V3 payment:', error);
        res.status(500).json({ error: error.message });
    } finally {
        session.endSession();
    }
};

