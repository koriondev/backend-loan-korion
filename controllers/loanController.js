console.log("DEBUG: loanController.js loading...");
function getVal(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'object' && v.$numberDecimal) return parseFloat(v.$numberDecimal);
    if (typeof v === 'object' && v.constructor.name === 'Decimal128') return parseFloat(v.toString());
    return parseFloat(v) || 0;
}

const mongoose = require('mongoose');
const Loan = require('../models/Loan');
const PaymentV2 = require('../models/PaymentV2');
const Client = require('../models/Client');
const Wallet = require('../models/Wallet');
const Settings = require('../models/Settings');
const { generateScheduleV3, getNextDueDate } = require('../engines/amortizationEngine');
const { calculatePenaltyV3 } = require('../engines/penaltyEngine');
const { distributePayment, applyPaymentToLoan, validatePaymentAmount } = require('../engines/paymentEngine');
const XLSX = require('xlsx');
const financeController = require('./financeController');
const eventBus = require('../utils/eventBus');

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

        const effectiveStartDate = startDate || new Date();
        const effectiveFirstPaymentDate = firstPaymentDate || getNextDueDate(effectiveStartDate, frequency);

        // Generate schedule V3
        const { schedule, summary } = generateScheduleV3({
            amount: parsedAmount,
            interestRateMonthly: parsedRate,
            duration: parsedDuration,
            frequency,
            frequencyMode,
            lendingType,
            startDate: effectiveStartDate,
            firstPaymentDate: effectiveFirstPaymentDate
        });

        // Extract wallet currency first
        const fundingWallet = await Wallet.findById(req.body.fundingWalletId).session(session);
        if (!fundingWallet) throw new Error('Cartera de fondeo no encontrada');

        // Create loan
        const newLoan = new Loan({
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
            startDate: effectiveStartDate,
            firstPaymentDate: effectiveFirstPaymentDate,
            gracePeriod: gracePeriod || 0,
            initialPaidInstallments: initialPaidInstallments || 0,

            // FUNDING & ATTRIBUTION
            fundingWalletId: req.body.fundingWalletId,
            investorId: req.body.investorId,
            managerId: req.body.managerId,
            revenueShare: req.body.revenueShare,

            status: 'active', // Will be updated below
            penaltyConfig: penaltyConfig || settings?.defaultPenaltyConfig || {
                type: 'fixed',
                value: 0,
                gracePeriod: 0,
                periodMode: 'daily',
                applyPerInstallment: false,
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
                requesterId: req.user.id || req.user._id,
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
    // Local helper for maximum safety against scope/reference errors
    const getValInternal = (v) => {
        if (v === null || v === undefined) return 0;
        if (typeof v === 'object' && v.$numberDecimal) return parseFloat(v.$numberDecimal);
        if (typeof v === 'object' && v.constructor.name === 'Decimal128') return parseFloat(v.toString());
        return parseFloat(v) || 0;
    };

    try {
        const businessIdStr = req.user.businessId;
        const businessId = new mongoose.Types.ObjectId(businessIdStr);
        let bizFilter = { businessId: { $in: [businessId, businessIdStr] } };

        // Handle Archiving filter
        if (req.query.status === 'archived') {
            bizFilter.status = 'archived';
        } else {
            bizFilter.status = { $ne: 'archived' };
        }

        const loans = await Loan.find(bizFilter)
            .populate('clientId', 'name cedula phone')
            .sort({ createdAt: -1 });

        const settings = await Settings.findOne({ businessId: req.user.businessId });

        // Enrich with calculated penalty V3
        const enrichedLoans = loans.map(loan => {
            const penaltyData = calculatePenaltyV3(loan, settings);
            const paidPenaltyVal = getValInternal(loan.penaltyConfig?.paidPenalty);
            const pendingPenalty = Math.max(0, (penaltyData?.totalPenalty || 0) - paidPenaltyVal);

            return {
                ...loan.toObject(),
                currentPenalty: pendingPenalty,
                penaltyPeriodsOverdue: penaltyData?.periodsOverdue || 0
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
        const loan = await Loan.findById(req.params.id)
            .populate('clientId', 'name cedula phone');

        if (!loan) {
            return res.status(404).json({ error: 'Préstamo no encontrado' });
        }

        const settings = await Settings.findOne({ businessId: loan.businessId });
        const penaltyData = calculatePenaltyV3(loan, settings);
        // Safety check for loan.penaltyConfig before accessing paidPenalty
        const paidPenaltyVal = getVal(loan.penaltyConfig?.paidPenalty);
        const pendingPenalty = Math.max(0, penaltyData.totalPenalty - paidPenaltyVal);

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

        const loan = await Loan.findById(loanId).populate('clientId').session(session);
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
        const validation = validatePaymentAmount(loan, amount, penaltyData);
        if (!validation.valid) {
            throw new Error(validation.message);
        }

        // Distribute payment
        const distribution = distributePayment(loan, amount, penaltyData);

        // Apply distribution to loan
        applyPaymentToLoan(loan, distribution, paymentDate);

        loan.markModified('schedule');
        loan.markModified('financialModel');
        loan.markModified('penaltyConfig');

        // FIX V3 MIGRATION: frequencyMode is sometimes saved as primitive 'standard', causing validation error
        if (loan.frequencyMode && typeof loan.frequencyMode === 'string') {
            loan.frequencyMode = {};
        }

        // Save loan
        await loan.save({ session, validateBeforeSave: false });

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

        // ─────────────────────────────────────────────────────────────────────────
        // Trigger Telegram Alerts (Decoupled)
        // ─────────────────────────────────────────────────────────────────────────
        eventBus.emit('payment_registered', {
            amount: amount,
            clientId: loan.clientId._id,
            clientName: loan.clientId.name || loan.clientId.cedula,
            businessId: loan.businessId,
            loanId: loan._id
        });

        res.json({
            success: true,
            payment,
            distribution,
            newLoanStatus: {
                status: loan.status,
                currentCapital: loan.currentCapital,
                pendingPenalty: Math.max(0, (penaltyData?.totalPenalty || 0) - getVal(loan.penaltyConfig?.paidPenalty))
            }
        });

    } catch (error) {
        await session.abortTransaction();
        console.error('Error registering payment:', error);

        // Distinguish between validation errors and internal errors
        const isValidationError = error.message.includes('excede') ||
            error.message.includes('inválido') ||
            error.message.includes('encontrado');

        res.status(isValidationError ? 400 : 500).json({
            success: false,
            error: error.message
        });
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
        const loan = await Loan.findById(req.params.id);

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

        const effectiveStartDate = startDate || new Date();
        const effectiveFirstPaymentDate = firstPaymentDate || getNextDueDate(effectiveStartDate, frequency);

        // Generate schedule V3
        const result = generateScheduleV3({
            amount: parseFloat(amount),
            interestRateMonthly: parseFloat(effectiveRate),
            duration: parseInt(duration),
            frequency,
            frequencyMode,
            lendingType,
            startDate: effectiveStartDate,
            firstPaymentDate: effectiveFirstPaymentDate
        });

        console.log("SCHEDULE GENERATED, FIRST ITEM:", result.schedule[0]);

        res.json({
            schedule: result.schedule,
            finalAmount: amount,
            finalRate: interestRateMonthly || interestRate,
            totalToPay: result.totalToPay,
            totalInterest: result.totalInterest
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
        const loan = await Loan.findById(req.params.id).populate('clientId').session(session);
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
                    `Tu solicitud para el préstamo de ${loan.clientId?.name || 'Cliente'} (#${loan._id.toString().slice(-6)}) ha sido APROBADA.`,
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
        const loan = await Loan.findById(req.params.id);
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

        const loan = await Loan.findById(id).populate('clientId').session(session);
        if (!loan) throw new Error("Préstamo no encontrado");

        // 1. Encontrar la primera cuota pendiente, parcial o atrasada
        const currentQuotaIndex = loan.schedule.findIndex(q => q.status === 'pending' || q.status === 'partial' || q.status === 'atrasado');
        if (currentQuotaIndex === -1) throw new Error("No hay cuotas pendientes para aplicar penalidad");

        const currentQuota = loan.schedule[currentQuotaIndex];
        const amortizationEngine = require('../engines/amortizationEngine');

        // 2. Calcular monto de la penalidad (Interés de la cuota actual o monto enviado)
        const rawInterestAmount = currentQuota.interestAmount != null ? currentQuota.interestAmount : currentQuota.interest;
        const rawPrincipalAmount = currentQuota.principalAmount != null ? currentQuota.principalAmount : currentQuota.capital;
        const fallbackPenalty = getVal(rawInterestAmount);

        // Usar monto proveído por el usuario o usar fallback
        const penaltyAmount = req.body.amount !== undefined ? Number(req.body.amount) : fallbackPenalty;
        if (penaltyAmount < 0) throw new Error("Monto de penalidad no puede ser negativo");

        // 3. Lógica de Desplazamiento (Shift)
        // Guardar montos originales para la nueva cuota final
        const originalPrincipal = rawPrincipalAmount;
        const originalInterest = rawInterestAmount;

        // Conservar pagos previos si existían (aunque Gana Tiempo suele aplicarse sobre cuotas sin pagar)
        const previousPaid = getVal(currentQuota.paidAmount);
        const previousInterestPaid = getVal(currentQuota.interestPaid);
        const previousCapitalPaid = getVal(currentQuota.capitalPaid);

        // Transformar cuota actual en penalidad
        loan.schedule[currentQuotaIndex].principalAmount = mongoose.Types.Decimal128.fromString("0.00");
        loan.schedule[currentQuotaIndex].interestAmount = mongoose.Types.Decimal128.fromString(penaltyAmount.toFixed(2));
        loan.schedule[currentQuotaIndex].amount = mongoose.Types.Decimal128.fromString(penaltyAmount.toFixed(2));

        // Si ya se había pagado algo, se mantiene como pago de esa penalidad
        loan.schedule[currentQuotaIndex].paidAmount = mongoose.Types.Decimal128.fromString(previousPaid.toFixed(2));
        loan.schedule[currentQuotaIndex].interestPaid = mongoose.Types.Decimal128.fromString(previousPaid.toFixed(2));
        loan.schedule[currentQuotaIndex].capitalPaid = mongoose.Types.Decimal128.fromString("0.00");

        // Si el monto pagado previamente es >= al monto de la penalidad, se marca como pagada
        if (previousPaid >= (penaltyAmount - 0.05)) {
            loan.schedule[currentQuotaIndex].status = 'paid';
            if (!loan.schedule[currentQuotaIndex].paidDate) loan.schedule[currentQuotaIndex].paidDate = paymentDate;
        } else if (previousPaid > 0) {
            loan.schedule[currentQuotaIndex].status = 'partial';
        } else {
            // Si es un "Gana Tiempo" procesado por el modal que dispara un pago simultáneo:
            loan.schedule[currentQuotaIndex].status = 'paid';
            loan.schedule[currentQuotaIndex].paidAmount = mongoose.Types.Decimal128.fromString(penaltyAmount.toFixed(2));
            loan.schedule[currentQuotaIndex].interestPaid = mongoose.Types.Decimal128.fromString(penaltyAmount.toFixed(2));
            loan.schedule[currentQuotaIndex].paidDate = paymentDate;
        }

        loan.schedule[currentQuotaIndex].notes = (loan.schedule[currentQuotaIndex].notes || "") + " [Penalidad Aplicada]";

        // 4. Rodar fechas de las cuotas futuras
        for (let i = currentQuotaIndex + 1; i < loan.schedule.length; i++) {
            loan.schedule[i].dueDate = amortizationEngine.getNextDueDate(loan.schedule[i].dueDate, loan.frequency);
        }

        // 5. Agregar nueva cuota al final
        const lastQuota = loan.schedule[loan.schedule.length - 1];
        const newDueDate = amortizationEngine.getNextDueDate(lastQuota.dueDate, loan.frequency);

        // Restaurar el capital que "desapareció" de la cuota penalizada
        // Si la cuota penalizada tenía pagos a capital, debemos recuperarlos
        const capitalToRestore = getVal(originalPrincipal) - previousCapitalPaid;

        loan.schedule.push({
            number: loan.schedule.length + 1,
            dueDate: newDueDate,
            amount: mongoose.Types.Decimal128.fromString((capitalToRestore + getVal(originalInterest)).toFixed(2)),
            principalAmount: mongoose.Types.Decimal128.fromString(capitalToRestore.toFixed(2)),
            interestAmount: originalInterest,
            balance: lastQuota.balance,
            status: 'pending',
            daysOfGrace: 0
        });

        // 6. Actualizar totales del préstamo
        if (!loan.financialModel) {
            loan.financialModel = { interestTotal: 0, interestPaid: 0, interestPending: 0 };
        }

        // El interés total sube porque la penalidad es "nuevo interés"
        loan.financialModel.interestTotal = (getVal(loan.financialModel.interestTotal) + penaltyAmount);

        // Si ya estaba pagada o se pagó ahora, sube el pagado
        if (loan.schedule[currentQuotaIndex].status === 'paid') {
            loan.financialModel.interestPaid = (getVal(loan.financialModel.interestPaid) + penaltyAmount - previousInterestPaid);
        } else {
            loan.financialModel.interestPaid = (getVal(loan.financialModel.interestPaid) - previousInterestPaid);
        }

        // Re-ajustar capital corriente si se devolvió capital pagado
        loan.currentCapital += previousCapitalPaid;

        loan.duration = loan.schedule.length;

        loan.markModified('schedule');
        loan.markModified('financialModel');

        if (loan.frequencyMode && typeof loan.frequencyMode === 'string') {
            loan.frequencyMode = {};
        }

        await loan.save({ session, validateBeforeSave: false });

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

        const receiptId = `REC-PEN-${Date.now().toString().slice(-6)}`;
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
            receiptId, // <--- Vincular con el recibo para permitir borrado
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
        const PaymentV2 = require('../models/PaymentV2');
        const payment = new PaymentV2({
            loanId: loan._id,
            date: paymentDate,
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

// End of Apply Penalty logic


/**
 * DELETE PAYMENT V3
 * Revierte un pago de PaymentV2 en un préstamo V3 restaurando el calendario y el balance
 */
exports.deletePayment = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { id: loanId, paymentId } = req.params;
        const PaymentV2 = require('../models/PaymentV2');
        const Transaction = require('../models/Transaction');

        let payment = await PaymentV2.findById(paymentId).session(session);
        let isV1 = false;
        if (!payment) {
            payment = await Transaction.findById(paymentId).session(session);
            if (!payment) throw new Error('Pago no encontrado');
            isV1 = true;
        }

        const loan = await Loan.findById(loanId).session(session);
        if (!loan) throw new Error('Préstamo no encontrado');

        if (loan.businessId.toString() !== req.user.businessId.toString()) {
            throw new Error('Acceso denegado');
        }

        const breakdown = payment.metadata?.breakdown || {};
        const appliedCapital = breakdown.capital || breakdown.appliedCapital || payment.appliedCapital || 0;
        const appliedInterest = breakdown.interest || breakdown.appliedInterest || payment.appliedInterest || 0;
        const appliedPenalty = breakdown.mora || breakdown.appliedPenalty || payment.appliedPenalty || 0;
        const amount = payment.amount;
        const walletId = payment.wallet || payment.walletId;

        const getD = (v) => v && v.$numberDecimal ? parseFloat(v.$numberDecimal) : parseFloat(v || 0);

        // --- LÓGICA ESPECIAL: REVERTIR GANA TIEMPO (SHIFT) ---
        const isPenaltyShift = payment.metadata?.concept === 'penalty_shift' || (payment.notes && payment.notes.includes("[Penalidad Aplicada]"));

        if (isPenaltyShift) {
            const amortizationEngine = require('../engines/amortizationEngine');

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
                    loan.schedule[i].dueDate = amortizationEngine.getPrevDueDate(loan.schedule[i].dueDate, loan.frequency);
                }

                // 5. Ajustar métricas financieras de forma segura
                loan.duration = Math.max(0, loan.schedule.length);
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
        await loan.save({ session, validateBeforeSave: false });

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

        // Eliminar el documento correcto
        if (isV1) {
            await Transaction.findByIdAndDelete(paymentId).session(session);
        } else {
            // Eliminar la Transaction de espejo relacionada (si existe)
            if (payment.receiptId) {
                await Transaction.deleteMany({ loanV3: loanId, receiptId: payment.receiptId }).session(session);
            } else {
                // Fallback de seguridad: Si no hay receiptId (por error previo), buscar por criteria parecida
                // Esto limpia los "huérfanos" que reporta el usuario
                const startTime = new Date(payment.date);
                startTime.setHours(0, 0, 0, 0);
                const endTime = new Date(payment.date);
                endTime.setHours(23, 59, 59, 999);

                await Transaction.deleteMany({
                    loanV3: loanId,
                    amount: payment.amount,
                    type: 'in_payment',
                    date: { $gte: startTime, $lte: endTime },
                    receiptId: { $exists: false }
                }).session(session);
            }
            // Eliminar el PaymentV2
            await PaymentV2.findByIdAndDelete(paymentId).session(session);
        }

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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GET ARREARS (Loans with overdue installments)
 * ═══════════════════════════════════════════════════════════════════════════
 */
exports.getArrears = async (req, res) => {
    try {
        const businessIdStr = req.user.businessId;
        const businessId = new mongoose.Types.ObjectId(businessIdStr);
        const bizFilter = { businessId: { $in: [businessId, businessIdStr] } };

        const today = new Date();
        today.setHours(23, 59, 59, 999);

        const settings = await Settings.findOne({ businessId });
        const loans = await Loan.find({
            ...bizFilter,
            status: { $in: ['active', 'past_due'] }
        }).populate('clientId', 'name phone cedula address');

        const arrearsList = [];


        loans.forEach(loan => {
            const overdueInstallments = (loan.schedule || []).filter(inst =>
                inst.status !== 'paid' && new Date(inst.dueDate) < today
            );

            if (overdueInstallments.length > 0) {
                // Suma de capital e interés PENDIENTE de cuotas vencidas (lo que realmente se debe)
                const overdueCapital = overdueInstallments.reduce((sum, inst) => {
                    const cap = getVal(inst.principalAmount != null ? inst.principalAmount : inst.capital);
                    const capPaid = getVal(inst.capitalPaid || 0);
                    return sum + Math.max(0, cap - capPaid);
                }, 0);

                const overdueInterest = overdueInstallments.reduce((sum, inst) => {
                    const interest = getVal(inst.interestAmount != null ? inst.interestAmount : inst.interest);
                    const intPaid = getVal(inst.interestPaid || 0);
                    return sum + Math.max(0, interest - intPaid);
                }, 0);

                // Calcular mora re-activado: ya que ahora la configuración global de mora y applyPerInstallment
                // previenen la inflación artificial exponencial.
                const penaltyData = calculatePenaltyV3(loan, settings, today);
                const paidPenalty = getVal(loan.penaltyConfig?.paidPenalty || 0);
                const pendingPenalty = Math.max(0, penaltyData.totalPenalty - paidPenalty);

                const totalOverdue = overdueCapital + overdueInterest + pendingPenalty;

                const firstOverdue = overdueInstallments[0];
                const d1 = new Date(today); d1.setHours(0, 0, 0, 0);
                const d2 = new Date(firstOverdue.dueDate); d2.setHours(0, 0, 0, 0);
                const daysLate = Math.round(Math.abs(d1 - d2) / (1000 * 60 * 60 * 24));

                arrearsList.push({
                    ...loan.toObject(),
                    _id: loan._id,
                    loanId: loan._id,
                    client: loan.clientId,
                    amount: loan.amount,
                    balance: loan.realBalance || loan.balance,
                    currentCapital: loan.currentCapital || (loan.realBalance || loan.balance),
                    currency: loan.currency || 'DOP',
                    installmentsCount: overdueInstallments.length,
                    overdueCount: overdueInstallments.length,
                    totalOverdue: totalOverdue,
                    overdueCapital,
                    overdueInterest,
                    pendingPenalty,
                    nextDueDate: overdueInstallments[0].dueDate,
                    daysLate: daysLate,
                    status: loan.status,
                    frequency: loan.frequency,
                    schedule: loan.schedule,
                    createdAt: loan.createdAt
                });
            }
        });

        // Ordenar por total de deuda (incluyendo mora)
        arrearsList.sort((a, b) => b.totalOverdue - a.totalOverdue);
        res.json(arrearsList);

    } catch (error) {
        console.error('❌ [LOANS] Error fetching arrears:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PAY LOAN (Unified)
 * ═══════════════════════════════════════════════════════════════════════════
 */
exports.payLoan = async (req, res) => {
    req.params.id = req.body.loanId;
    return exports.registerPayment(req, res);
};

// ═══════════════════════════════════════════════════════════════════════════
// ARCHIVE / RESTORE LOANS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ARCHIVE LOAN
 * Behaves like a reversal: reverts wallet/client balance impacts but keeps data.
 */
exports.archiveLoan = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const loanId = req.params.id;
        const loan = await Loan.findById(loanId).session(session);

        if (!loan) return res.status(404).json({ error: 'Préstamo no encontrado' });
        if (loan.status === 'archived') return res.status(400).json({ error: 'El préstamo ya está archivado' });

        const Transaction = require('../models/Transaction');
        const payments = await PaymentV2.find({ loanId }).session(session);
        const txs = await Transaction.find({
            $or: [
                { loanV3: loanId },
                { loanV2: loanId },
                { loan: loanId },
                { 'metadata.loanId': loanId.toString() },
                { description: { $regex: loanId.toString().slice(-6) } }
            ]
        }).session(session);

        // 1. Revert Disbursement Impact
        if (loan.status !== 'pending_approval' && loan.status !== 'rejected') {
            const wallet = await Wallet.findById(loan.fundingWalletId).session(session);
            if (wallet) {
                wallet.balance += loan.amount;
                await wallet.save({ session });
            }

            // Total Debt Reversal (Principal + Interest)
            const totalToRevert = loan.schedule.reduce((sum, q) => sum + getVal(q.principalAmount || q.capital) + getVal(q.interestAmount || q.interest), 0);
            await Client.findByIdAndUpdate(loan.clientId, { $inc: { balance: -totalToRevert } }, { session });
        }

        // 2. Revert Each Payment Impact
        for (const p of payments) {
            const pWallet = await Wallet.findById(p.walletId).session(session);
            if (pWallet) {
                pWallet.balance -= p.amount;
                await pWallet.save({ session });
            }
            await Client.findByIdAndUpdate(loan.clientId, { $inc: { balance: p.amount } }, { session });
            p.isArchived = true;
            await p.save({ session });
        }

        // 3. Mark Transactions as Archived
        for (const tx of txs) {
            tx.isArchived = true;
            await tx.save({ session });
        }

        // 4. Update Loan Status
        loan.previousStatus = loan.status;
        loan.status = 'archived';
        await loan.save({ session, validateBeforeSave: false });

        await session.commitTransaction();

        // Recalcular balance de cartera para seguridad
        if (loan.fundingWalletId) {
            await financeController.recalculateWalletBalance(loan.fundingWalletId);
        }

        res.json({ success: true, message: 'Préstamo archivado correctamente. Sus balances fueron revertidos.' });
    } catch (e) {
        await session.abortTransaction();
        res.status(500).json({ error: e.message });
    } finally {
        session.endSession();
    }
};

/**
 * RESTORE LOAN
 * Re-applies balance impacts.
 */
exports.restoreLoan = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const loanId = req.params.id;
        const loan = await Loan.findById(loanId).session(session);

        if (!loan) return res.status(404).json({ error: 'Préstamo no encontrado' });
        if (loan.status !== 'archived') return res.status(400).json({ error: 'El préstamo no está archivado' });

        const Transaction = require('../models/Transaction');
        const payments = await PaymentV2.find({ loanId }).session(session);
        const txs = await Transaction.find({
            $or: [
                { loanV3: loanId },
                { loanV2: loanId },
                { loan: loanId },
                { 'metadata.loanId': loanId.toString() },
                { description: { $regex: loanId.toString().slice(-6) } }
            ]
        }).session(session);

        // 1. Re-apply Disbursement Impact
        if (loan.previousStatus !== 'pending_approval' && loan.previousStatus !== 'rejected') {
            const wallet = await Wallet.findById(loan.fundingWalletId).session(session);
            if (wallet) {
                wallet.balance -= loan.amount;
                await wallet.save({ session });
            }

            const totalToRestore = loan.schedule.reduce((sum, q) => sum + getVal(q.principalAmount || q.capital) + getVal(q.interestAmount || q.interest), 0);
            await Client.findByIdAndUpdate(loan.clientId, { $inc: { balance: totalToRestore } }, { session });
        }

        // 2. Re-apply Each Payment Impact
        for (const p of payments) {
            const pWallet = await Wallet.findById(p.walletId).session(session);
            if (pWallet) {
                pWallet.balance += p.amount;
                await pWallet.save({ session });
            }
            await Client.findByIdAndUpdate(loan.clientId, { $inc: { balance: -p.amount } }, { session });
            p.isArchived = false;
            await p.save({ session });
        }

        // 3. Mark Transactions as Un-Archived
        for (const tx of txs) {
            tx.isArchived = false;
            await tx.save({ session });
        }

        // 4. Restore Status
        loan.status = loan.previousStatus || 'active';
        loan.previousStatus = null;
        await loan.save({ session, validateBeforeSave: false });

        await session.commitTransaction();

        if (loan.fundingWalletId) {
            await financeController.recalculateWalletBalance(loan.fundingWalletId);
        }

        res.json({ success: true, message: 'Préstamo restaurado correctamente. Sus balances fueron restablecidos.' });
    } catch (e) {
        await session.abortTransaction();
        res.status(500).json({ error: e.message });
    } finally {
        session.endSession();
    }
};


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RECALCULATE LOAN (On-demand)
 * ═══════════════════════════════════════════════════════════════════════════
 */
exports.recalculateLoan = async (req, res) => {
    try {
        const { id } = req.params;
        const loan = await Loan.findById(id);
        if (!loan) return res.status(404).json({ error: 'Préstamo no encontrado' });

        const Settings = require('../models/Settings');
        const penaltyEngine = require('../engines/penaltyEngine');
        const settings = await Settings.findOne({ businessId: loan.businessId });

        const now = new Date();
        now.setHours(0, 0, 0, 0);

        const penaltyData = penaltyEngine.calculatePenaltyV3(loan, settings);

        // GT Consumption Logic: Lógica de Seguro de Tiempo
        const paidGTs = (loan.schedule || []).filter(q => q.status === 'paid' && q.notes && q.notes.includes("[Penalidad Aplicada]")).length;

        const allOverdue = (loan.schedule || []).filter(q => {
            if (q.status === 'paid') return false;
            const dueDate = new Date(q.dueDate);
            return dueDate < now;
        });

        // Consumimos los atrasos más antiguos con los pagos de GT que tengamos.
        const overdueInstallments = allOverdue.slice(paidGTs);

        let daysLate = 0;
        if (overdueInstallments.length > 0) {
            const firstOverdue = overdueInstallments[0];
            const diffTime = Math.abs(now - new Date(firstOverdue.dueDate));
            daysLate = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }

        // Actualizar persistencia en DB
        loan.status = overdueInstallments.length > 0 ? 'past_due' : 'active';
        loan.daysLate = daysLate;
        loan.installmentsOverdue = overdueInstallments.length;
        loan.pendingPenalty = penaltyData.totalPenalty;

        // Force check for "active" if it was past_due
        if (overdueInstallments.length === 0 && loan.status === 'past_due') {
            loan.status = 'active';
        }

        await loan.save({ validateBeforeSave: false });

        res.json({
            success: true,
            message: "Préstamo recalculado exitosamente",
            data: {
                status: loan.status,
                daysLate: loan.daysLate,
                installmentsOverdue: loan.installmentsOverdue,
                pendingPenalty: loan.pendingPenalty
            }
        });
    } catch (error) {
        console.error('❌ Error recalculando préstamo:', error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = exports;

/**
 * RECALCULATE LOAN BALANCE (On-demand)
 * Updates loan status, days late, and pending penalties based on current date.
 */
exports.recalculateLoan = async (req, res) => {
    try {
        const { id } = req.params;
        const Loan = require('../models/Loan');
        const Settings = require('../models/Settings');
        const penaltyEngine = require('../engines/penaltyEngine');

        const loan = await Loan.findById(id);
        if (!loan) return res.status(404).json({ error: 'Préstamo no encontrado' });

        const settings = await Settings.findOne({ businessId: loan.businessId });
        const penaltyData = penaltyEngine.calculatePenaltyV3(loan, settings);

        const now = new Date();
        now.setHours(0, 0, 0, 0);

        const overdueInstallments = (loan.schedule || []).filter(q => {
            if (q.status === 'paid') return false;
            // Respect Time Insurance (Gana Tiempo)
            if (q.notes && q.notes.includes("[Penalidad Aplicada]")) return false;
            const dueDate = new Date(q.dueDate);
            return dueDate < now;
        });

        let daysLate = 0;
        if (overdueInstallments.length > 0) {
            const firstOverdue = overdueInstallments[0];
            const diffTime = Math.abs(now - new Date(firstOverdue.dueDate));
            daysLate = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }

        // Update loan metrics
        loan.status = overdueInstallments.length > 0 ? 'past_due' : (loan.status === 'past_due' ? 'active' : loan.status);
        loan.daysLate = daysLate;
        loan.installmentsOverdue = overdueInstallments.length;

        // Final penalty is engine calculation minus what's already paid
        const getVal = (v) => {
            if (v === null || v === undefined) return 0;
            if (typeof v === 'object' && v.$numberDecimal) return parseFloat(v.$numberDecimal);
            if (typeof v === 'object' && v.constructor.name === 'Decimal128') return parseFloat(v.toString());
            return parseFloat(v) || 0;
        };
        const paidPenalty = getVal(loan.penaltyConfig?.paidPenalty || 0);
        loan.pendingPenalty = Math.max(0, penaltyData.totalPenalty - paidPenalty);

        await loan.save({ validateBeforeSave: false });

        res.json({
            success: true,
            message: "Balance recalculado exitosamente",
            loan
        });

    } catch (error) {
        console.error('❌ Error recalculando préstamo:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RECONCILIATION EXCEL EXPORT
 * ═══════════════════════════════════════════════════════════════════════════
 */
exports.exportAudit = async (req, res) => {
    try {
        const { loanIds } = req.body;
        if (!loanIds || !Array.isArray(loanIds)) {
            return res.status(400).json({ error: 'IDs de préstamos no válidos' });
        }

        const Loan = require('../models/Loan');
        const Transaction = require('../models/Transaction');

        const loans = await Loan.find({ _id: { $in: loanIds } }).populate('clientId');

        const getV = (v) => {
            if (v === null || v === undefined) return 0;
            if (typeof v === 'object' && v.$numberDecimal) return parseFloat(v.$numberDecimal);
            if (typeof v === 'object' && v.constructor?.name === 'Decimal128') return parseFloat(v.toString());
            return parseFloat(v) || 0;
        };

        const excelData = [];

        for (const loan of loans) {
            const shortId = loan._id.toString().slice(-6).toUpperCase();

            // 1. Fetch all associated transactions
            const txs = await Transaction.find({
                $or: [
                    { loan: loan._id },
                    { loanV2: loan._id },
                    { loanV3: loan._id },
                    { "metadata.loanId": loan._id.toString() }
                ],
                type: 'in_payment'
            }).sort({ date: 1 });

            const totalPayments = txs.reduce((sum, t) => sum + (t.amount || 0), 0);

            // 2. Audit Logic: Recalculate theoretical balance from contract + penalties
            const schedule = loan.schedule || [];
            const regularQuotas = schedule.filter(q => !(q.notes && q.notes.includes("[Penalidad Aplicada]")));
            const qAmt = regularQuotas.length > 0 ? getV(regularQuotas[0].amount) : 0;

            // Total Penalties (Manual/Shifts)
            const sumPenalties = schedule.filter(q => q.notes && q.notes.includes("[Penalidad Aplicada]"))
                .reduce((s, q) => s + getV(q.amount), 0);

            const initialDur = loan.initialDuration || (schedule.length - schedule.filter(q => q.notes && q.notes.includes("[Penalidad Aplicada]")).length);

            // Expected Contract Total = P + I + Penalties
            const expectedTotalDebt = (qAmt * initialDur) + sumPenalties;

            // Balance Factura = (Contract Total) - (Payments)
            const balanceFactura = Math.max(0, expectedTotalDebt - totalPayments);

            // Balance Web = Current stats in DB
            const balanceWeb = getV(loan.currentCapital) + getV(loan.financialModel?.interestPending);

            excelData.push({
                "Cliente": loan.clientId?.fullName || loan.clientId?.name || 'Desconocido',
                "Cédula": loan.clientId?.cedula || 'N/A',
                "ID Préstamo": shortId,
                "Fecha Inicio": new Date(loan.startDate).toLocaleDateString('es-DO'),
                "Monto Original": loan.amount,
                "Tasa %": loan.interestRateMonthly || 0,
                "Cuotas Totales": schedule.length,
                "Pagos Totales (DB)": totalPayments.toFixed(2),
                "Total Contrato (P+I+Pen)": expectedTotalDebt.toFixed(2),
                "MONTO ADEUDADO (WEB)": balanceWeb.toFixed(2),
                "MONTO ADEUDADO (FACTURA)": balanceFactura.toFixed(2),
                "DIFERENCIA": (balanceWeb - balanceFactura).toFixed(2),
                "Estado Web": (loan.status || 'active').toUpperCase(),
                "Atraso (Días)": loan.daysLate || 0
            });
        }

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(excelData);

        // Autofit columns (basic attempt)
        const wscols = Object.keys(excelData[0] || {}).map(k => ({ wch: Math.max(k.length, 12) + 5 }));
        ws['!cols'] = wscols;

        XLSX.utils.book_append_sheet(wb, ws, "Reconciliacion");

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Auditoria_Reconciliacion_${new Date().toISOString().split('T')[0]}.xlsx`);
        res.send(buffer);

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
};
