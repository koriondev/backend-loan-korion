/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PAYMENT ENGINE V3
 * ═══════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');

const legacyPaymentEngine = require('./legacyPaymentEngine');

const getVal = (v) => {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'object' && v.$numberDecimal) return parseFloat(v.$numberDecimal);
    if (typeof v === 'object' && v.constructor.name === 'Decimal128') return parseFloat(v.toString());
    return parseFloat(v) || 0;
};
const toDecimal = (v) => mongoose.Types.Decimal128.fromString(parseFloat(v).toFixed(2));

const distributePaymentV3 = (loan, amount, currentPenalty) => {
    let remainingPayment = parseFloat(amount);

    const distribution = {
        appliedPenalty: 0,
        appliedInterest: 0,
        appliedCapital: 0,
        installmentUpdates: [],
        isFullPayoff: false
    };

    // 1. Apply to Penalty first (Safety check for loan.penaltyConfig)
    const paidPenalty = loan.penaltyConfig ? getVal(loan.penaltyConfig.paidPenalty) : 0;
    const pendingPenalty = Math.max(0, getVal(currentPenalty.totalPenalty) - paidPenalty);

    if (pendingPenalty > 0) {
        const penaltyPayment = Math.min(remainingPayment, pendingPenalty);
        distribution.appliedPenalty = penaltyPayment;
        remainingPayment -= penaltyPayment;
    }

    // 2. Apply to Interest and Capital per installment
    for (let i = 0; i < loan.schedule.length; i++) {
        if (remainingPayment <= 0.01) break;

        const inst = loan.schedule[i];
        if (inst.status === 'paid') continue;

        const installmentUpdate = {
            number: inst.number,
            interestPaid: 0,
            capitalPaid: 0,
            newStatus: inst.status
        };

        // 2a. Pay Interest & Capital with 10 pesos tolerance
        const rawInterestTotal = inst.interestAmount != null ? inst.interestAmount : inst.interest;
        const pendingInterest = getVal(rawInterestTotal) - getVal(inst.interestPaid);

        const rawCapitalTotal = inst.principalAmount != null ? inst.principalAmount : inst.capital;
        const pendingCapital = getVal(rawCapitalTotal) - getVal(inst.capitalPaid);

        const pendingQuota = pendingInterest + pendingCapital;

        let applyInterest = 0;
        let applyCapital = 0;

        if (remainingPayment > 0.01 && remainingPayment < pendingQuota && remainingPayment >= (pendingQuota - 10.00)) {
            // We fully pay this installment with tolerance!
            applyInterest = pendingInterest;
            applyCapital = pendingCapital;
            remainingPayment = 0; // The payment is fully consumed
        } else {
            // Standard partial payment flow
            if (pendingInterest > 0.01) {
                applyInterest = Math.min(remainingPayment, pendingInterest);
                remainingPayment -= applyInterest;
            }
            if (remainingPayment > 0.01 && pendingCapital > 0.01) {
                applyCapital = Math.min(remainingPayment, pendingCapital);
                remainingPayment -= applyCapital;
            }
        }

        installmentUpdate.interestPaid = applyInterest;
        installmentUpdate.capitalPaid = applyCapital;
        distribution.appliedInterest += applyInterest;
        distribution.appliedCapital += applyCapital;

        // Determine new status with 10 pesos tolerance
        const totalInterestPaid = getVal(inst.interestPaid) + installmentUpdate.interestPaid;
        const totalCapitalPaid = getVal(inst.capitalPaid) + installmentUpdate.capitalPaid;

        if (totalInterestPaid >= (getVal(rawInterestTotal) - 10.00) && totalCapitalPaid >= (getVal(rawCapitalTotal) - 10.00)) {
            installmentUpdate.newStatus = 'paid';
        } else if (totalInterestPaid > 0.01 || totalCapitalPaid > 0.01) {
            installmentUpdate.newStatus = 'partial';
        }

        distribution.installmentUpdates.push(installmentUpdate);
    }

    // Check if loan is fully paid
    const allPaid = loan.schedule.every(inst => {
        const update = distribution.installmentUpdates.find(u => u.number === inst.number);
        return (update ? update.newStatus : inst.status) === 'paid';
    });
    distribution.isFullPayoff = allPaid;

    return distribution;
};

const applyPaymentToLoanV3 = (loan, distribution, paymentDate = null) => {
    // Update penalty paid
    if (distribution.appliedPenalty > 0) {
        if (!loan.penaltyConfig) {
            loan.penaltyConfig = { type: 'fixed', value: 0, paidPenalty: 0 };
        }
        loan.penaltyConfig.paidPenalty = toDecimal(getVal(loan.penaltyConfig.paidPenalty) + distribution.appliedPenalty);
    }

    // Update schedule
    distribution.installmentUpdates.forEach(update => {
        const inst = loan.schedule.find(i => i.number === update.number);
        if (inst) {
            inst.interestPaid = toDecimal(getVal(inst.interestPaid) + update.interestPaid);
            inst.capitalPaid = toDecimal(getVal(inst.capitalPaid) + update.capitalPaid);
            inst.paidAmount = toDecimal(getVal(inst.interestPaid) + getVal(inst.capitalPaid));
            inst.status = update.newStatus;

            if (inst.status === 'paid' && !inst.paidDate) {
                inst.paidDate = paymentDate || new Date();
            }
        }
    });

    // Update capital and model
    loan.currentCapital -= distribution.appliedCapital;
    loan.financialModel.interestPaid += distribution.appliedInterest;
    loan.financialModel.interestPending = Math.max(0, loan.financialModel.interestTotal - loan.financialModel.interestPaid);

    if (distribution.isFullPayoff || loan.currentCapital <= 0.1) {
        loan.status = 'paid';
        loan.currentCapital = 0;
    }

    loan.markModified('schedule');
    loan.markModified('financialModel');
    loan.markModified('penaltyConfig');

    return loan;
};

const validatePaymentAmountV3 = (loan, amount, currentPenalty) => {
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) return { valid: false, message: 'Monto inválido' };

    const paidPenalty = loan.penaltyConfig ? getVal(loan.penaltyConfig.paidPenalty) : 0;
    const pendingPenalty = Math.max(0, getVal(currentPenalty.totalPenalty) - paidPenalty);

    // Fallback if financialModel is out of sync or missing interestPending
    const pendingInterestFromSchedule = (loan.schedule || []).reduce((sum, q) => {
        const rawInt = q.interestAmount != null ? q.interestAmount : q.interest;
        return sum + Math.max(0, getVal(rawInt) - getVal(q.interestPaid));
    }, 0);

    const pendingInterest = Math.max(getVal(loan.financialModel?.interestPending), pendingInterestFromSchedule);
    const pendingCapital = Math.max(getVal(loan.currentCapital), getVal(loan.balance));

    const totalDebt = pendingPenalty + pendingInterest + pendingCapital;

    if (val > totalDebt + 10) {
        return { valid: false, message: `El monto excede la deuda total (${totalDebt.toFixed(2)})` };
    }

    return { valid: true };
};

// ═══════════════════════════════════════════════════════════════════════════
// FACTORY PATTERN EXPORTS
// ═══════════════════════════════════════════════════════════════════════════
exports.distributePayment = (loan, amount, penaltyData) => {
    if (loan.version < 3) {
        return legacyPaymentEngine.distributePayment(loan, amount, penaltyData);
    }
    return distributePaymentV3(loan, amount, penaltyData);
};

exports.applyPaymentToLoan = (loan, distribution, paymentDate = null) => {
    if (loan.version < 3) {
        return legacyPaymentEngine.applyPaymentToLoan(loan, distribution, paymentDate);
    }
    return applyPaymentToLoanV3(loan, distribution, paymentDate);
};

exports.validatePaymentAmount = (loan, amount, penaltyData) => {
    if (loan.version < 3) {
        return legacyPaymentEngine.validatePaymentAmount(loan, amount, penaltyData);
    }
    return validatePaymentAmountV3(loan, amount, penaltyData);
};

