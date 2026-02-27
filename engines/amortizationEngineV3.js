const { RRule } = require('rrule');
const Holidays = require('date-holidays');
const mongoose = require('mongoose');

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AMORTIZATION ENGINE V3 (Financial Precision & RD Compliance)
 * ═══════════════════════════════════════════════════════════════════════════
 */

const hd = new Holidays('DO');

/**
 * Checks if a date is a holiday or weekend in Dominican Republic.
 * Includes Law 139-97 logic (implicit in date-holidays 'DO' config usually).
 */
const isNonWorkingDay = (date) => {
    const day = date.getDay();
    if (day === 0) return true; // Sunday is always non-working for payments

    const holiday = hd.isHoliday(date);
    if (holiday) return true;

    return false;
};

/**
 * Adjusts a date to the next working day if it falls on a non-working day.
 */
const adjustToNextWorkingDay = (date) => {
    const adjusted = new Date(date);
    while (isNonWorkingDay(adjusted)) {
        adjusted.setDate(adjusted.getDate() + 1);
    }
    return adjusted;
};

/**
 * EMI Formula: [P * r * (1 + r)^n] / [(1 + r)^n - 1]
 * Uses higher precision for intermediate steps.
 */
const calculateEMI = (principal, periodicRate, periods) => {
    if (periodicRate === 0) return principal / periods;

    const p = parseFloat(principal);
    const r = parseFloat(periodicRate);
    const n = parseInt(periods);

    const emi = (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    return emi;
};

/**
 * Get periodic rate from monthly rate based on frequency.
 */
const getPeriodicRate = (monthlyRate, frequency) => {
    const rateDecimal = parseFloat(monthlyRate) / 100;

    switch (frequency.toLowerCase()) {
        case 'daily': return rateDecimal / 30;
        case 'weekly': return rateDecimal / 4;
        case 'biweekly': return rateDecimal / 2;
        case 'monthly': return rateDecimal;
        default: return rateDecimal;
    }
};

/**
 * Generate Schedule V3
 */
exports.generateScheduleV3 = (params) => {
    const {
        amount,
        interestRateMonthly,
        duration,
        frequency,
        startDate,
        firstPaymentDate,
        lendingType // 'amortization' (EMI) or 'fixed'
    } = params;

    const principal = parseFloat(amount);
    const periodicRate = getPeriodicRate(interestRateMonthly, frequency);
    const n = parseInt(duration);

    // 1. Calculate Quota
    let quotaValue = 0;
    if (lendingType === 'amortization') {
        quotaValue = calculateEMI(principal, periodicRate, n);
    } else if (lendingType === 'fixed') {
        // Flat interest: (Principal / n) + (Principal * periodicRate)
        quotaValue = (principal / n) + (principal * periodicRate);
    } else {
        // Redito style: Only interest first, principal at end or manual
        quotaValue = principal * periodicRate;
    }

    // 2. Generate Recursive Dates using RRule
    const freqMap = {
        'daily': RRule.DAILY,
        'weekly': RRule.WEEKLY,
        'biweekly': RRule.WEEKLY,
        'monthly': RRule.MONTHLY
    };

    const rruleOptions = {
        freq: freqMap[frequency.toLowerCase()],
        dtstart: new Date(firstPaymentDate),
        count: (lendingType === 'redito' && !duration) ? 12 : n
    };

    if (frequency.toLowerCase() === 'biweekly') {
        rruleOptions.interval = 2;
    }

    const rule = new RRule(rruleOptions);
    const dates = rule.all();

    // 3. Build Schedule
    let currentBalance = principal;
    const schedule = [];

    dates.forEach((date, index) => {
        const adjustedDate = adjustToNextWorkingDay(date);

        let interest = 0;
        let capital = 0;
        let quota = quotaValue;

        if (lendingType === 'amortization') {
            interest = currentBalance * periodicRate;
            capital = quota - interest;
            currentBalance -= capital;
        } else if (lendingType === 'fixed') {
            interest = principal * periodicRate;
            capital = principal / n;
            currentBalance -= capital;
        } else {
            // Redito
            interest = principal * periodicRate;
            capital = 0;
            // Balance stays same until manual capital payment
        }

        // Final installment adjustment to kill the cents if needed
        if (index === dates.length - 1 && lendingType !== 'redito') {
            if (Math.abs(currentBalance) < 1) {
                capital += currentBalance;
                quota += currentBalance;
                currentBalance = 0;
            }
        }

        schedule.push({
            number: index + 1,
            dueDate: adjustedDate,
            amount: mongoose.Types.Decimal128.fromString(quota.toFixed(2)),
            principalAmount: mongoose.Types.Decimal128.fromString(capital.toFixed(2)),
            interestAmount: mongoose.Types.Decimal128.fromString(interest.toFixed(2)),
            balance: mongoose.Types.Decimal128.fromString(Math.max(0, currentBalance).toFixed(2)),
            status: 'pending',
            daysOfGrace: 0
        });
    });

    return {
        schedule,
        totalInterest: schedule.reduce((acc, s) => acc + parseFloat(s.interestAmount.toString()), 0).toFixed(2),
        totalToPay: (principal + schedule.reduce((acc, s) => acc + parseFloat(s.interestAmount.toString()), 0)).toFixed(2)
    };
};

/**
 * Internal helper to get next recurring date
 */
const getNextDateInternal = (fromDate, frequency) => {
    const date = new Date(fromDate);
    switch (frequency.toLowerCase()) {
        case 'daily': date.setDate(date.getDate() + 1); break;
        case 'weekly': date.setDate(date.getDate() + 7); break;
        case 'biweekly': date.setDate(date.getDate() + 14); break;
        case 'monthly': date.setMonth(date.getMonth() + 1); break;
        default: date.setDate(date.getDate() + 7);
    }
    return adjustToNextWorkingDay(date);
};

module.exports = {
    generateScheduleV3: exports.generateScheduleV3,
    isWorkingDay: (date) => !isNonWorkingDay(date),
    adjustToNextWorkingDay,
    getNextDueDate: getNextDateInternal
};
