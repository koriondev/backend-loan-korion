/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PENALTY ENGINE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Calculates late fees/penalties (mora) for overdue loans.
 * Supports: Fixed amount, Percentage-based, Grace periods
 */

/**
 * Calculate penalty for a loan
 * @param {Object} loan - LoanV2 instance
 * @param {Object} settings - Business settings (working days, holidays)
 * @returns {Object} { totalPenalty, breakdown, periodsOverdue }
 */
const calculatePenalty = (loan, settings = null) => {
    if (!loan.penaltyConfig || !loan.penaltyConfig.type) {
        return { totalPenalty: 0, breakdown: [], periodsOverdue: 0 };
    }

    const { type } = loan.penaltyConfig;

    switch (type) {
        case 'fixed':
            return calculateFixedPenalty(loan, settings);
        case 'percent':
            return calculatePercentPenalty(loan, settings);
        default:
            return { totalPenalty: 0, breakdown: [], periodsOverdue: 0 };
    }
};

/**
 * Calculate fixed penalty amount
 * @param {Object} loan - Loan instance
 * @param {Object} settings - Settings instance
 * @returns {Object} Penalty details
 */
const calculateFixedPenalty = (loan, settings) => {
    const config = loan.penaltyConfig;
    const { value, gracePeriod, applyPerInstallment, periodMode, maxPenalty } = config;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // Get overdue installments
    const overdueInstallments = loan.schedule.filter(inst => {
        if (inst.status === 'paid') return false;
        const dueDate = new Date(inst.dueDate);
        return dueDate < startOfToday;
    });

    if (overdueInstallments.length === 0) {
        return { totalPenalty: 0, breakdown: [], periodsOverdue: 0 };
    }

    let totalPenalty = 0;
    const breakdown = [];

    if (applyPerInstallment) {
        // Apply penalty per overdue installment
        overdueInstallments.forEach(inst => {
            const penaltyForInst = calculatePenaltyForInstallment(
                inst,
                value,
                gracePeriod,
                periodMode,
                settings
            );

            breakdown.push({
                installmentNumber: inst.number,
                dueDate: inst.dueDate,
                penalty: penaltyForInst
            });

            totalPenalty += penaltyForInst;
        });
    } else {
        // Apply penalty once based on oldest installment
        const oldestOverdue = overdueInstallments[0];
        const periodsOverdue = getOverduePeriods(oldestOverdue.dueDate, periodMode, gracePeriod, settings);

        totalPenalty = value * periodsOverdue;

        breakdown.push({
            installmentNumber: oldestOverdue.number,
            dueDate: oldestOverdue.dueDate,
            periodsOverdue: periodsOverdue,
            penalty: totalPenalty
        });
    }

    // Apply max penalty cap if configured
    if (maxPenalty && totalPenalty > maxPenalty) {
        totalPenalty = maxPenalty;
    }

    return {
        totalPenalty,
        breakdown,
        periodsOverdue: breakdown.reduce((sum, b) => sum + (b.periodsOverdue || 0), 0)
    };
};

/**
 * Calculate percentage-based penalty
 * @param {Object} loan - Loan instance
 * @param {Object} settings - Settings instance
 * @returns {Object} Penalty details
 */
const calculatePercentPenalty = (loan, settings) => {
    const config = loan.penaltyConfig;
    const { value, gracePeriod, applyPerInstallment, applyOn, periodMode, maxPenalty } = config;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const overdueInstallments = loan.schedule.filter(inst => {
        if (inst.status === 'paid') return false;
        const dueDate = new Date(inst.dueDate);
        return dueDate < startOfToday;
    });

    if (overdueInstallments.length === 0) {
        return { totalPenalty: 0, breakdown: [], periodsOverdue: 0 };
    }

    let totalPenalty = 0;
    const breakdown = [];

    if (applyPerInstallment) {
        // Apply percentage per installment
        overdueInstallments.forEach(inst => {
            const base = getBaseAmount(inst, applyOn);
            const periodsOverdue = getOverduePeriods(inst.dueDate, periodMode, gracePeriod, settings);
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
        // Apply once based on oldest
        const oldestOverdue = overdueInstallments[0];
        const base = getBaseAmount(oldestOverdue, applyOn);
        const periodsOverdue = getOverduePeriods(oldestOverdue.dueDate, periodMode, gracePeriod, settings);
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

    // Apply max penalty cap
    if (maxPenalty && totalPenalty > maxPenalty) {
        totalPenalty = maxPenalty;
    }

    return {
        totalPenalty,
        breakdown,
        periodsOverdue: breakdown.reduce((sum, b) => sum + (b.periodsOverdue || 0), 0)
    };
};

/**
 * Calculate penalty for a single installment (fixed mode)
 * @param {Object} installment - Schedule installment
 * @param {Number} value - Penalty value
 * @param {Number} gracePeriod - Grace period in days
 * @param {String} periodMode - Period mode (daily/weekly/etc)
 * @param {Object} settings - Business settings
 * @returns {Number} Penalty amount
 */
const calculatePenaltyForInstallment = (installment, value, gracePeriod, periodMode, settings) => {
    const periodsOverdue = getOverduePeriods(installment.dueDate, periodMode, gracePeriod, settings);
    return value * periodsOverdue;
};

/**
 * Get number of overdue periods
 * @param {Date} dueDate - Original due date
 * @param {String} periodMode - 'daily', 'weekly', 'biweekly', 'monthly'
 * @param {Number} gracePeriod - Grace period in days
 * @param {Object} settings - Business settings
 * @returns {Number} Number of overdue periods
 */
const getOverduePeriods = (dueDate, periodMode, gracePeriod, settings) => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // Apply grace period
    const graceDeadline = applyGracePeriod(new Date(dueDate), gracePeriod, settings);

    // If still within grace, no penalty
    if (startOfToday <= graceDeadline) {
        return 0;
    }

    // Calculate days overdue after grace
    let currentDate = new Date(graceDeadline);
    currentDate.setDate(currentDate.getDate() + 1); // Start from day after grace

    let workingDaysOverdue = 0;
    while (currentDate < startOfToday) {
        if (isWorkingDay(currentDate, settings)) {
            workingDaysOverdue++;
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }

    // Convert to periods based on mode
    switch (periodMode) {
        case 'daily':
            return workingDaysOverdue;
        case 'weekly':
            return Math.floor(workingDaysOverdue / 7);
        case 'biweekly':
            return Math.floor(workingDaysOverdue / 15);
        case 'monthly':
            return Math.floor(workingDaysOverdue / 30);
        default:
            return workingDaysOverdue;
    }
};

/**
 * Apply grace period to due date
 * @param {Date} dueDate - Original due date
 * @param {Number} graceDays - Grace period in working days
 * @param {Object} settings - Business settings
 * @returns {Date} Grace deadline
 */
const applyGracePeriod = (dueDate, graceDays, settings) => {
    if (graceDays <= 0) return new Date(dueDate);

    let deadline = new Date(dueDate);
    let addedDays = 0;

    while (addedDays < graceDays) {
        deadline.setDate(deadline.getDate() + 1);
        if (isWorkingDay(deadline, settings)) {
            addedDays++;
        }
    }

    // If grace ends on non-working day, extend to next working day
    while (!isWorkingDay(deadline, settings)) {
        deadline.setDate(deadline.getDate() + 1);
    }

    return deadline;
};

/**
 * Check if a date is a working day
 * @param {Date} date - Date to check
 * @param {Object} settings - Business settings
 * @returns {Boolean} True if working day
 */
const isWorkingDay = (date, settings) => {
    if (!settings || !settings.workingDays) return true;

    const dayOfWeek = date.getDay();

    if (!settings.workingDays.includes(dayOfWeek)) {
        return false;
    }

    if (settings.nonWorkingDates && settings.nonWorkingDates.length > 0) {
        const dateStr = date.toISOString().split('T')[0];
        if (settings.nonWorkingDates.includes(dateStr)) {
            return false;
        }
    }

    return true;
};

/**
 * Get base amount for percentage calculation
 * @param {Object} installment - Schedule installment
 * @param {String} applyOn - 'quota', 'capital', 'interest', 'balance'
 * @returns {Number} Base amount
 */
const getBaseAmount = (installment, applyOn) => {
    switch (applyOn) {
        case 'quota':
            return installment.amount;
        case 'capital':
            return installment.capital;
        case 'interest':
            return installment.interest;
        case 'balance':
            return installment.balance_after;
        default:
            return installment.amount;
    }
};

module.exports = {
    calculatePenalty,
    calculateFixedPenalty,
    calculatePercentPenalty,
    getOverduePeriods,
    applyGracePeriod,
    isWorkingDay
};
