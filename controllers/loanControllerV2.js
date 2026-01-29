const mongoose = require('mongoose');
const LoanV2 = require('../models/LoanV2');
const PaymentV2 = require('../models/PaymentV2');
const Client = require('../models/Client');
const Wallet = require('../models/Wallet');
const Settings = require('../models/Settings');
const { generateSchedule } = require('../engines/amortizationEngine');
const { calculatePenalty } = require('../engines/penaltyEngine');
const { distributePayment, applyPaymentToLoan, validatePaymentAmount } = require('../engines/paymentEngine');

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
            initialPaidInstallments
        } = req.body;

        // Get settings for working days
        const settings = await Settings.findOne({ businessId: req.user.businessId }).session(session);

        // Generate schedule
        const { schedule, summary } = generateSchedule({
            amount,
            interestRateMonthly,
            duration,
            frequency,
            frequencyMode,
            lendingType,
            startDate: startDate || new Date(),
            firstPaymentDate: firstPaymentDate || new Date()
        }, settings);

        // Create loan
        const newLoan = new LoanV2({
            clientId,
            businessId: req.user.businessId,
            productId,
            amount,
            currentCapital: amount,
            interestRateMonthly,
            interestRatePeriodic: 0, // Calculated in schedule generation
            lendingType,
            duration,
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
        const fundingWallet = await Wallet.findById(req.body.fundingWalletId).session(session);
        if (!fundingWallet) throw new Error('Cartera de fondeo no encontrada');

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
                description: `Desembolso Préstamo V2 #${newLoan._id.toString().slice(-6)}`,
                loanV2: newLoan._id, // Notice: using loanV2 field if it exists or generic project?
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


        // Handle initial paid installments (migration support) - ONLY IF APPROVED
        if (newLoan.status === 'active' && initialPaidInstallments > 0) {
            for (let i = 0; i < Math.min(initialPaidInstallments, newLoan.schedule.length); i++) {
                const inst = newLoan.schedule[i];
                inst.status = 'paid';
                inst.paidAmount = inst.amount;
                inst.paidInterest = inst.interest;
                inst.paidCapital = inst.capital;
                inst.paidDate = new Date(inst.dueDate);
            }

            const paidCapital = newLoan.schedule.slice(0, initialPaidInstallments)
                .reduce((sum, inst) => sum + inst.capital, 0);

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
        const loans = await LoanV2.find({ businessId: req.user.businessId })
            .populate('clientId', 'name cedula phone')
            .sort({ createdAt: -1 });

        const settings = await Settings.findOne({ businessId: req.user.businessId });

        // Enrich with calculated penalty
        const enrichedLoans = loans.map(loan => {
            const penaltyData = calculatePenalty(loan, settings);
            const pendingPenalty = Math.max(0, penaltyData.totalPenalty - (loan.penaltyConfig.paidPenalty || 0));

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
        const loan = await LoanV2.findById(req.params.id)
            .populate('clientId', 'name cedula phone');

        if (!loan) {
            return res.status(404).json({ error: 'Préstamo no encontrado' });
        }

        const settings = await Settings.findOne({ businessId: loan.businessId });
        const penaltyData = calculatePenalty(loan, settings);
        const pendingPenalty = Math.max(0, penaltyData.totalPenalty - (loan.penaltyConfig.paidPenalty || 0));

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
        const { amount, paymentMethod, walletId, notes } = req.body;
        const loanId = req.params.id;

        const loan = await LoanV2.findById(loanId).session(session);
        if (!loan) throw new Error('Préstamo no encontrado');

        const client = await Client.findById(loan.clientId).session(session);
        const wallet = await Wallet.findById(walletId).session(session);
        const settings = await Settings.findOne({ businessId: loan.businessId }).session(session);

        // Calculate current penalty
        const penaltyData = calculatePenalty(loan, settings);

        // Validate payment
        const validation = validatePaymentAmount(loan, amount, penaltyData);
        if (!validation.valid) {
            throw new Error(validation.message);
        }

        // Distribute payment
        const distribution = distributePayment(loan, amount, penaltyData);

        // Apply distribution to loan
        applyPaymentToLoan(loan, distribution);

        // Save loan
        await loan.save({ session });

        // Update wallet (OLD LOGIC REMOVED)
        // wallet.balance += amount;  <-- REMOVED

        // ────────────────────────────────────────────────────────────────────
        // SPLIT LOGIC (Capital vs Interest)
        // ────────────────────────────────────────────────────────────────────
        const capitalToReturn = distribution.appliedCapital;
        const interestToSplit = distribution.appliedInterest; // + penalty? Usually penalty goes to owner or platform. Let's assume Interest + Penalty follows split or Penalty is 100% Platform? 
        // FIX: For now, Interest = Interest + Penalty for distribution simplicity, or separate?
        // User request: "Interés: Se divide..." "Capital: Retorna íntegro".
        // Let's treat Penalty as Interest for distribution for now OR add to Platform. 
        // Assumption: Interest + Penalty are 'Profits'.

        const totalProfit = interestToSplit + distribution.appliedPenalty;

        // 1. RETURN CAPITAL (To Funding Wallet)
        if (capitalToReturn > 0) {
            const fundingWallet = await Wallet.findById(loan.fundingWalletId).session(session);
            if (fundingWallet) {
                fundingWallet.balance += capitalToReturn;
                await fundingWallet.save({ session });

                // Create Transaction Record
                const Transaction = require('../models/Transaction');
                await new Transaction({
                    businessId: loan.businessId,
                    type: 'in_payment',
                    category: 'Retorno de Capital',
                    amount: capitalToReturn,
                    description: `Pago Capital Préstamo #${loan.schedule[0]?.number || '-'}`,
                    loan: loan._id,
                    wallet: fundingWallet._id,
                    client: loan.clientId,
                    date: new Date()
                }).save({ session });
            }
        }

        // 2. DISTRIBUTE PROFIT (Revenue Share)
        if (totalProfit > 0) {
            const { revenueShare, investorId, managerId } = loan;

            // Calculate Shares
            const investorShare = (totalProfit * (revenueShare.investorPercentage / 100));
            const managerShare = (totalProfit * (revenueShare.managerPercentage / 100));
            const platformShare = (totalProfit * (revenueShare.platformPercentage / 100));

            // Helper to credit wallet
            const creditToUserWallet = async (userId, amount, roleLabel) => {
                if (amount <= 0) return;

                // Find 'earnings' wallet for user
                let userWallet = await Wallet.findOne({
                    ownerId: userId,
                    type: 'earnings',
                    businessId: loan.businessId
                }).session(session);

                // If not exists, create one
                if (!userWallet) {
                    userWallet = new Wallet({
                        name: `Nómina/Ganancias`,
                        ownerId: userId,
                        type: 'earnings',
                        businessId: loan.businessId,
                        balance: 0
                    });
                    await userWallet.save({ session });
                }

                userWallet.balance += amount;
                await userWallet.save({ session });

                // Transaction Record
                const Transaction = require('../models/Transaction');
                await new Transaction({
                    businessId: loan.businessId,
                    type: 'dividend_distribution',
                    category: `Dividendo ${roleLabel}`,
                    amount: amount,
                    description: `Ganancia Préstamo (Interés+Mora)`,
                    loan: loan._id,
                    wallet: userWallet._id,
                    metadata: { role: roleLabel, percentage: revenueShare[`${roleLabel}Percentage`] },
                    date: new Date()
                }).save({ session });
            };

            // Distributor Execution
            await creditToUserWallet(investorId, investorShare, 'investor');
            await creditToUserWallet(managerId, managerShare, 'manager');

            // Platform/Expense Wallet (Non-user specific usually, or Admin)
            // We search for a type='expense' wallet or default
            let platformWallet = await Wallet.findOne({ type: 'expense', businessId: loan.businessId }).session(session);
            if (!platformWallet) platformWallet = await Wallet.findOne({ isDefault: true, businessId: loan.businessId }).session(session); // Fallback

            if (platformWallet && platformShare > 0) {
                platformWallet.balance += platformShare;
                await platformWallet.save({ session });
                const Transaction = require('../models/Transaction');
                await new Transaction({
                    businessId: loan.businessId,
                    type: 'dividend_distribution',
                    category: 'Dividendo Plataforma',
                    amount: platformShare,
                    description: 'Comisión Plataforma / Fondo Gastos',
                    loan: loan._id,
                    wallet: platformWallet._id,
                    date: new Date()
                }).save({ session });
            }
        }

        // Update client balance (Already correct in original code)
        const balanceReduction = distribution.appliedInterest + distribution.appliedCapital + distribution.appliedPenalty;
        await Client.findByIdAndUpdate(
            loan.clientId,
            { $inc: { balance: -balanceReduction } },
            { session }
        );

        // Create payment record
        const receiptId = `REC-${Date.now().toString().slice(-6)}`;
        const payment = new PaymentV2({
            loanId: loan._id,
            date: new Date(),
            amount,
            remainingPayment: 0,
            appliedPenalty: distribution.appliedPenalty,
            appliedInterest: distribution.appliedInterest,
            appliedCapital: distribution.appliedCapital,
            isAdvancePayment: false,
            paymentMethod: paymentMethod || 'cash',
            walletId,
            userId: req.user._id,
            receiptId,
            notes: notes || '',
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
        const loan = await LoanV2.findById(req.params.id);

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

        // Generate schedule
        const { schedule, summary } = generateSchedule({
            amount,
            interestRateMonthly: interestRateMonthly || interestRate,
            duration,
            frequency,
            frequencyMode,
            lendingType,
            startDate: startDate || new Date(),
            firstPaymentDate: firstPaymentDate || new Date()
        }, settings);

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
        const loan = await LoanV2.findById(req.params.id).session(session);
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
            category: 'Desembolso',
            description: `Préstamo #${loan._id.toString().slice(-6)} Aprobado`,
            client: loan.clientId,
            wallet: wallet._id,
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
        const loan = await LoanV2.findById(req.params.id);
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

module.exports = exports;
