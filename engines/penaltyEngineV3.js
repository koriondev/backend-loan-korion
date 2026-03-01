const { isWorkingDay } = require('./amortizationEngineV3'); // We'll export it from there too

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PENALTY ENGINE V3
 * ═══════════════════════════════════════════════════════════════════════════
 */

const getVal = (v) => (v && typeof v.toString === 'function' && v.constructor.name === 'Decimal128') ? parseFloat(v.toString()) : (parseFloat(v) || 0);

exports.calculatePenaltyV3 = (loan, settings = null, referenceDate = null) => {
    if (!loan.penaltyConfig || !loan.penaltyConfig.type) {
        return { totalPenalty: 0, breakdown: [], periodsOverdue: 0 };
    }

    const { type } = loan.penaltyConfig;

    switch (type) {
        case 'fixed':
            return calculateFixedPenaltyV3(loan, settings, referenceDate);
        case 'percent':
            return calculatePercentPenaltyV3(loan, settings, referenceDate);
        default:
            return { totalPenalty: 0, breakdown: [], periodsOverdue: 0 };
    }
};

const calculateFixedPenaltyV3 = (loan, settings, referenceDate = null) => {
    const config = loan.penaltyConfig;
    const { value, gracePeriod, applyPerInstallment, periodMode, maxPenalty } = config;

    const refDay = referenceDate ? new Date(referenceDate) : new Date();
    refDay.setHours(0, 0, 0, 0);

    const overdueInstallments = loan.schedule.filter(inst => {
        if (inst.status === 'paid') return false;
        const dueDate = new Date(inst.dueDate);
        return dueDate < refDay;
    });

    if (overdueInstallments.length === 0) {
        return { totalPenalty: 0, breakdown: [], periodsOverdue: 0 };
    }

    let totalPenalty = 0;
    const breakdown = [];

    if (applyPerInstallment) {
        overdueInstallments.forEach(inst => {
            const periodsOverdue = getOverduePeriods(inst.dueDate, periodMode, gracePeriod, settings, refDay);
            const penaltyForInst = value * periodsOverdue;

            breakdown.push({
                installmentNumber: inst.number,
                dueDate: inst.dueDate,
                penalty: penaltyForInst
            });

            totalPenalty += penaltyForInst;
        });
    } else {
        const oldestOverdue = overdueInstallments[0];
        const periodsOverdue = getOverduePeriods(oldestOverdue.dueDate, periodMode, gracePeriod, settings, refDay);
        totalPenalty = value * periodsOverdue;

        breakdown.push({
            installmentNumber: oldestOverdue.number,
            dueDate: oldestOverdue.dueDate,
            periodsOverdue: periodsOverdue,
            penalty: totalPenalty
        });
    }

    if (maxPenalty && totalPenalty > maxPenalty) totalPenalty = maxPenalty;

    return {
        totalPenalty,
        breakdown,
        periodsOverdue: breakdown.reduce((sum, b) => sum + (b.periodsOverdue || 0), 0)
    };
};

const calculatePercentPenaltyV3 = (loan, settings, referenceDate = null) => {
    const config = loan.penaltyConfig;
    const { value, gracePeriod, applyPerInstallment, applyOn, periodMode, maxPenalty } = config;

    const refDay = referenceDate ? new Date(referenceDate) : new Date();
    refDay.setHours(0, 0, 0, 0);

    const overdueInstallments = loan.schedule.filter(inst => {
        if (inst.status === 'paid') return false;
        const dueDate = new Date(inst.dueDate);
        return dueDate < refDay;
    });

    if (overdueInstallments.length === 0) {
        return { totalPenalty: 0, breakdown: [], periodsOverdue: 0 };
    }

    let totalPenalty = 0;
    const breakdown = [];

    if (applyPerInstallment) {
        overdueInstallments.forEach(inst => {
            const base = getBaseAmountV3(inst, applyOn);
            const periodsOverdue = getOverduePeriods(inst.dueDate, periodMode, gracePeriod, settings, refDay);
            const penaltyForInst = (base * value / 100) * periodsOverdue;

            breakdown.push({
                installmentNumber: inst.number,
                dueDate: inst.dueDate,
                base: base,
                periodsOverdue: periodsOverdue,
                penalty: penaltyForInst
            });

            totalPenalty += penaltyForInst;
        });
    } else {
        const oldestOverdue = overdueInstallments[0];
        const base = getBaseAmountV3(oldestOverdue, applyOn);
        const periodsOverdue = getOverduePeriods(oldestOverdue.dueDate, periodMode, gracePeriod, settings, refDay);
        const penalty = (base * value / 100) * periodsOverdue;

        breakdown.push({
            installmentNumber: oldestOverdue.number,
            dueDate: oldestOverdue.dueDate,
            base: base,
            periodsOverdue: periodsOverdue,
            penalty: penalty
        });

        totalPenalty = penalty;
    }

    if (maxPenalty && totalPenalty > maxPenalty) totalPenalty = maxPenalty;

    return {
        totalPenalty,
        breakdown,
        periodsOverdue: breakdown.reduce((sum, b) => sum + (b.periodsOverdue || 0), 0)
    };
};

const getOverduePeriods = (dueDate, periodMode, gracePeriod, settings, refDay = null) => {
    const startOfToday = refDay || new Date();
    if (!refDay) startOfToday.setHours(0, 0, 0, 0);

    const graceDeadline = new Date(dueDate);
    graceDeadline.setDate(graceDeadline.getDate() + gracePeriod);

    if (startOfToday <= graceDeadline) return 0;

    const diffTime = Math.abs(startOfToday - graceDeadline);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    switch (periodMode) {
        case 'daily': return diffDays;
        case 'weekly': return Math.floor(diffDays / 7);
        case 'biweekly': return Math.floor(diffDays / 15);
        case 'monthly': return Math.floor(diffDays / 30);
        default: return diffDays;
    }
};

const getBaseAmountV3 = (installment, applyOn) => {
    switch (applyOn) {
        case 'quota': return getVal(installment.amount);
        case 'capital': return getVal(installment.principalAmount != null ? installment.principalAmount : installment.capital);
        case 'interest': return getVal(installment.interestAmount != null ? installment.interestAmount : installment.interest);
        case 'balance': return getVal(installment.balance != null ? installment.balance : (installment.balance_after != null ? installment.balance_after : installment.balance_start));
        default: return getVal(installment.amount);
    }
};
