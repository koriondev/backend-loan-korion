/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AMORTIZATION ENGINE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Generates amortization schedules for different loan types.
 * Supports: Redito, Fixed, Amortization (Banking)
 */

const { generateDueDates } = require('./frequencyEngine');

/**
 * Round to nearest 5
 * @param {Number} num - Number to round
 * @returns {Number} Rounded number
 */
const roundToNearestFive = (num) => Math.round(num / 5) * 5;

/**
 * Calculate periodic interest rate from monthly rate
 * @param {Number} monthlyRate - Monthly rate in percent (e.g. 15)
 * @param {String} frequency - Payment frequency
 * @returns {Number} Periodic rate as decimal
 */
const getPeriodicRate = (monthlyRate, frequency) => {
    const rateDecimal = Number(monthlyRate) / 100;
    let divisor = 1;
    const freq = (frequency || '').toLowerCase();

    if (freq === 'daily') divisor = 30;
    if (freq === 'weekly') divisor = 4;
    if (freq === 'biweekly' || freq === '15_30' || freq === '1_16') divisor = 2;
    if (freq === 'monthly') divisor = 1;

    return rateDecimal / divisor;
};

/**
 * Generate complete loan schedule
 * @param {Object} loanData - Loan configuration
 * @param {Object} settings - Business settings
 * @returns {Object} { schedule, summary }
 */
const generateSchedule = (loanData, settings = null) => {
    const {
        amount,
        interestRateMonthly,
        duration,
        frequency,
        frequencyMode,
        lendingType,
        startDate,
        firstPaymentDate
    } = loanData;

    switch (lendingType) {
        case 'redito':
            return generateReditoSchedule({
                amount,
                interestRateMonthly,
                duration,
                frequency,
                frequencyMode,
                startDate,
                firstPaymentDate,
                settings
            });

        case 'fixed':
            return generateFixedSchedule({
                amount,
                interestRateMonthly,
                duration,
                frequency,
                frequencyMode,
                startDate,
                firstPaymentDate,
                settings
            });

        case 'amortization':
            return generateAmortizationSchedule({
                amount,
                interestRateMonthly,
                duration,
                frequency,
                frequencyMode,
                startDate,
                firstPaymentDate,
                settings
            });

        default:
            throw new Error(`Unknown lending type: ${lendingType}`);
    }
};

/**
 * Generate Redito schedule
 * - No fixed term (but can have maximum periods)
 * - Interest per period on outstanding capital
 * - Capital paid whenever client wants
 */
const generateReditoSchedule = (params) => {
    const {
        amount,
        interestRateMonthly,
        duration,
        frequency,
        frequencyMode,
        firstPaymentDate,
        settings
    } = params;

    const periodicRate = getPeriodicRate(interestRateMonthly, frequency);
    const interestAmount = roundToNearestFive(amount * periodicRate);

    // Generate due dates
    const dueDates = generateDueDates(
        firstPaymentDate,
        frequency,
        frequencyMode,
        duration || 12, // Default to 12 if no duration specified
        settings
    );

    const schedule = dueDates.map((dueDate, index) => ({
        number: index + 1,
        dueDate: dueDate,
        amount: interestAmount,
        capital: 0, // Capital not fixed per installment
        interest: interestAmount,
        penaltyGenerated: 0,
        capitalPaid: 0,
        interestPaid: 0,
        penaltyPaid: 0,
        paidAmount: 0,
        paidDate: null,
        status: 'pending',
        balance_start: amount,
        balance_after: amount // Capital doesn't decrease automatically
    }));

    const summary = {
        interestTotal: interestAmount, // Interest of first installment for Redito
        capitalTotal: amount,
        totalToPay: amount + interestAmount, // Initial total debt including first interest
        installmentCount: schedule.length
    };

    return { schedule, summary };
};

/**
 * Generate Fixed schedule
 * - Fixed payment amount each period
 * - Capital = total capital / number of periods
 * - Interest = flat interest on original amount
 */
const generateFixedSchedule = (params) => {
    const {
        amount,
        interestRateMonthly,
        duration,
        frequency,
        frequencyMode,
        firstPaymentDate,
        settings
    } = params;

    const periodicRate = getPeriodicRate(interestRateMonthly, frequency);

    // Calculate interest
    const interestTotalTheoretical = amount * periodicRate * duration;
    const totalToPayTheoretical = amount + interestTotalTheoretical;
    const paymentTheoretical = totalToPayTheoretical / duration;
    const paymentAmount = roundToNearestFive(paymentTheoretical);

    const totalToPayReal = paymentAmount * duration;
    const interestTotalReal = totalToPayReal - amount;

    const capitalPart = amount / duration;
    const interestPart = interestTotalReal / duration;

    // Generate due dates
    const dueDates = generateDueDates(
        firstPaymentDate,
        frequency,
        frequencyMode,
        duration,
        settings
    );

    let currentTotalDebt = totalToPayReal;

    const schedule = dueDates.map((dueDate, index) => {
        currentTotalDebt -= paymentAmount;

        return {
            number: index + 1,
            dueDate: dueDate,
            amount: paymentAmount,
            capital: capitalPart,
            interest: interestPart,
            penaltyGenerated: 0,
            capitalPaid: 0,
            interestPaid: 0,
            penaltyPaid: 0,
            paidAmount: 0,
            paidDate: null,
            status: 'pending',
            balance_start: currentTotalDebt + paymentAmount,
            balance_after: Math.max(0, currentTotalDebt)
        };
    });

    const summary = {
        interestTotal: interestTotalReal,
        capitalTotal: amount,
        totalToPay: totalToPayReal,
        installmentCount: schedule.length
    };

    return { schedule, summary };
};

/**
 * Generate Amortization schedule (Banking system)
 * - Uses financial formula for equal payments
 * - Interest calculated on reducing balance
 * - Capital portion increases over time
 */
const generateAmortizationSchedule = (params) => {
    const {
        amount,
        interestRateMonthly,
        duration,
        frequency,
        frequencyMode,
        firstPaymentDate,
        settings
    } = params;

    const periodicRate = getPeriodicRate(interestRateMonthly, frequency);

    // Calculate payment using amortization formula
    let paymentTheoretical = 0;
    if (periodicRate === 0) {
        paymentTheoretical = amount / duration;
    } else {
        paymentTheoretical = amount * (periodicRate * Math.pow(1 + periodicRate, duration)) /
            (Math.pow(1 + periodicRate, duration) - 1);
    }

    const paymentAmount = roundToNearestFive(paymentTheoretical);

    // Generate due dates
    const dueDates = generateDueDates(
        firstPaymentDate,
        frequency,
        frequencyMode,
        duration,
        settings
    );

    let currentBalance = amount;
    const schedule = [];

    dueDates.forEach((dueDate, index) => {
        const interestPart = currentBalance * periodicRate;
        const capitalPart = paymentAmount - interestPart;
        currentBalance -= capitalPart;

        schedule.push({
            number: index + 1,
            dueDate: dueDate,
            amount: paymentAmount,
            capital: capitalPart,
            interest: interestPart,
            penaltyGenerated: 0,
            capitalPaid: 0,
            interestPaid: 0,
            penaltyPaid: 0,
            paidAmount: 0,
            paidDate: null,
            status: 'pending',
            balance_start: currentBalance + capitalPart,
            balance_after: Math.max(0, currentBalance)
        });
    });

    const summary = {
        interestTotal: schedule.reduce((acc, s) => acc + s.interest, 0),
        capitalTotal: amount,
        totalToPay: schedule.reduce((acc, s) => acc + s.amount, 0),
        installmentCount: schedule.length
    };

    return { schedule, summary };
};

module.exports = {
    generateSchedule,
    generateReditoSchedule,
    generateFixedSchedule,
    generateAmortizationSchedule,
    getPeriodicRate,
    roundToNearestFive
};
