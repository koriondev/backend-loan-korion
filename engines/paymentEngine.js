/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PAYMENT ENGINE V3
 * ═══════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');

const legacyPaymentEngine = require('./legacyPaymentEngine');

const getVal = (v) => (v && typeof v.toString === 'function' && v.constructor.name === 'Decimal128') ? parseFloat(v.toString()) : (parseFloat(v) || 0);
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

        // 2a. Pay Interest
        const rawInterestTotal = inst.interestAmount != null ? inst.interestAmount : inst.interest;
        const pendingInterest = getVal(rawInterestTotal) - getVal(inst.interestPaid);
        if (pendingInterest > 0.01) {
            const interestPayment = Math.min(remainingPayment, pendingInterest);
            installmentUpdate.interestPaid = interestPayment;
            distribution.appliedInterest += interestPayment;
            remainingPayment -= interestPayment;
        }

        // 2b. Pay Capital
        const rawCapitalTotal = inst.principalAmount != null ? inst.principalAmount : inst.capital;
        if (remainingPayment > 0.01) {
            const pendingCapital = getVal(rawCapitalTotal) - getVal(inst.capitalPaid);
            if (pendingCapital > 0.01) {
                const capitalPayment = Math.min(remainingPayment, pendingCapital);
                installmentUpdate.capitalPaid = capitalPayment;
                distribution.appliedCapital += capitalPayment;
                remainingPayment -= capitalPayment;
            }
        }

        // Determine new status
        const totalInterestPaid = getVal(inst.interestPaid) + installmentUpdate.interestPaid;
        const totalCapitalPaid = getVal(inst.capitalPaid) + installmentUpdate.capitalPaid;

        if (totalInterestPaid >= (getVal(rawInterestTotal) - 0.05) && totalCapitalPaid >= (getVal(rawCapitalTotal) - 0.05)) {
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

const applyPaymentToLoanV3 = (loan, distribution) => {
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
                inst.paidDate = new Date();
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

exports.applyPaymentToLoan = (loan, distribution) => {
    if (loan.version < 3) {
        return legacyPaymentEngine.applyPaymentToLoan(loan, distribution);
    }
    return applyPaymentToLoanV3(loan, distribution);
};

exports.validatePaymentAmount = (loan, amount, penaltyData) => {
    if (loan.version < 3) {
        return legacyPaymentEngine.validatePaymentAmount(loan, amount, penaltyData);
    }
    return validatePaymentAmountV3(loan, amount, penaltyData);
};

