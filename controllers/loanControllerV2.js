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
            status: 'active',
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

        // Handle initial paid installments (migration support)
        if (initialPaidInstallments > 0) {
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

        // Update wallet
        let wallet = await Wallet.findOne({ isDefault: true, businessId: req.user.businessId }).session(session);
        if (!wallet) wallet = await Wallet.findOne({ businessId: req.user.businessId }).session(session);

        if (!wallet || wallet.balance < amount) {
            throw new Error('Fondos insuficientes en caja');
        }

        wallet.balance -= amount;
        await wallet.save({ session });

        // Save loan
        await newLoan.save({ session });

        // Update client balance
        await Client.findByIdAndUpdate(
            clientId,
            { $inc: { balance: summary.totalToPay } },
            { session }
        );

        await session.commitTransaction();

        res.status(201).json({
            success: true,
            loan: newLoan,
            summary
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

        // Update wallet
        wallet.balance += amount;
        await wallet.save({ session });

        // Update client balance
        const balanceReduction = distribution.appliedInterest + distribution.appliedCapital;
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

module.exports = exports;
