/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FREQUENCY ENGINE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Generates payment due dates based on frequency configuration.
 * Handles: Daily, Weekly, Biweekly, Monthly with various modes.
 */

/**
 * Generate array of due dates for a loan
 * @param {Date} startDate - Start date of the loan
 * @param {String} frequency - 'daily', 'weekly', 'biweekly', 'monthly'
 * @param {Object} frequencyConfig - Configuration object
 * @param {Number} count - Number of due dates to generate
 * @param {Object} settings - Business settings (working days, holidays)
 * @returns {Array<Date>} Array of due dates
 */
const generateDueDates = (startDate, frequency, frequencyConfig, count, settings = null) => {
    const dueDates = [];
    let currentDate = new Date(startDate);

    for (let i = 0; i < count; i++) {
        if (i === 0) {
            // First payment date might be custom
            dueDates.push(new Date(currentDate));
        } else {
            currentDate = getNextDueDate(currentDate, frequency, frequencyConfig);

            // Adjust for working days if settings provided
            if (settings) {
                currentDate = adjustForWorkingDays(currentDate, settings);
            }

            dueDates.push(new Date(currentDate));
        }
    }

    return dueDates;
};

/**
 * Get next due date from a given date
 * @param {Date} lastDate - Last due date
 * @param {String} frequency - Frequency type
 * @param {Object} config - Frequency configuration
 * @returns {Date} Next due date
 */
const getNextDueDate = (lastDate, frequency, config) => {
    switch (frequency) {
        case 'daily':
            return handleDailyFrequency(lastDate, config);
        case 'weekly':
            return handleWeeklyFrequency(lastDate, config);
        case 'biweekly':
            return handleBiweeklyFrequency(lastDate, config);
        case 'monthly':
            return handleMonthlyFrequency(lastDate, config);
        default:
            throw new Error(`Unknown frequency: ${frequency}`);
    }
};

/**
 * Handle daily frequency
 * @param {Date} date - Current date
 * @param {Object} config - { dailyInterval: 1 }
 * @returns {Date} Next date
 */
const handleDailyFrequency = (date, config) => {
    const interval = config.dailyInterval || 1;
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + interval);
    return nextDate;
};

/**
 * Handle weekly frequency
 * @param {Date} date - Current date
 * @param {Object} config - { weeklyInterval: 1, weeklyDay: null }
 * @returns {Date} Next date
 */
const handleWeeklyFrequency = (date, config) => {
    const nextDate = new Date(date);

    if (config.weeklyDay !== null && config.weeklyDay !== undefined) {
        // Fixed day of week (0 = Sunday, 6 = Saturday)
        const currentDay = nextDate.getDay();
        const targetDay = config.weeklyDay;

        let daysToAdd = targetDay - currentDay;
        if (daysToAdd <= 0) daysToAdd += 7;

        nextDate.setDate(nextDate.getDate() + daysToAdd);
    } else {
        // Interval-based (every N weeks)
        const interval = config.weeklyInterval || 1;
        nextDate.setDate(nextDate.getDate() + (7 * interval));
    }

    return nextDate;
};

/**
 * Handle biweekly frequency
 * @param {Date} date - Current date
 * @param {Object} config - { biweeklyMode: 'each15' | '1_16' | '15_30' }
 * @returns {Date} Next date
 */
const handleBiweeklyFrequency = (date, config) => {
    const mode = config.biweeklyMode || 'each15';
    const nextDate = new Date(date);

    switch (mode) {
        case 'each15':
            // Every 15 days
            nextDate.setDate(nextDate.getDate() + 15);
            break;

        case '1_16':
            // Day 1 and 16 of each month
            {
                const currentDay = nextDate.getDate();
                if (currentDay < 16) {
                    nextDate.setDate(16);
                } else {
                    nextDate.setMonth(nextDate.getMonth() + 1);
                    nextDate.setDate(1);
                }
            }
            break;

        case '15_30':
            // Day 15 and last day of month
            {
                const currentDay = nextDate.getDate();
                const year = nextDate.getFullYear();
                const month = nextDate.getMonth();
                const lastDay = new Date(year, month + 1, 0).getDate();

                if (currentDay < 15) {
                    nextDate.setDate(15);
                } else if (currentDay >= 15 && currentDay < lastDay) {
                    nextDate.setDate(lastDay);
                } else {
                    nextDate.setMonth(month + 1);
                    nextDate.setDate(15);
                }
            }
            break;
    }

    return nextDate;
};

/**
 * Handle monthly frequency
 * @param {Date} date - Current date
 * @param {Object} config - { monthlyMode: 'same_day' | 'end_of_month' | 'every30' }
 * @returns {Date} Next date
 */
const handleMonthlyFrequency = (date, config) => {
    const mode = config.monthlyMode || 'same_day';
    const nextDate = new Date(date);

    switch (mode) {
        case 'same_day':
            // Same day next month
            {
                const currentDay = nextDate.getDate();
                nextDate.setMonth(nextDate.getMonth() + 1);

                // Handle month-end edge cases (e.g., Jan 31 -> Feb 28)
                const year = nextDate.getFullYear();
                const month = nextDate.getMonth();
                const lastDay = new Date(year, month + 1, 0).getDate();

                if (currentDay > lastDay) {
                    nextDate.setDate(lastDay);
                } else {
                    nextDate.setDate(currentDay);
                }
            }
            break;

        case 'end_of_month':
            // Last day of next month
            nextDate.setMonth(nextDate.getMonth() + 1);
            nextDate.setDate(0); // Last day of previous month (so, current month)
            break;

        case 'every30':
            // Every 30 days
            nextDate.setDate(nextDate.getDate() + 30);
            break;
    }

    return nextDate;
};

/**
 * Adjust date to next working day if it falls on non-working day
 * @param {Date} date - Date to adjust
 * @param {Object} settings - { workingDays: [1,2,3,4,5], nonWorkingDates: [] }
 * @returns {Date} Adjusted date
 */
const adjustForWorkingDays = (date, settings) => {
    if (!settings || !settings.workingDays) return date;

    const adjustedDate = new Date(date);

    while (!isWorkingDay(adjustedDate, settings)) {
        adjustedDate.setDate(adjustedDate.getDate() + 1);
    }

    return adjustedDate;
};

/**
 * Check if a date is a working day
 * @param {Date} date - Date to check
 * @param {Object} settings - Business settings
 * @returns {Boolean} True if working day
 */
const isWorkingDay = (date, settings) => {
    if (!settings) return true;

    const dayOfWeek = date.getDay();

    // Check if day is in working days list
    if (settings.workingDays && !settings.workingDays.includes(dayOfWeek)) {
        return false;
    }

    // Check if date is a holiday
    if (settings.nonWorkingDates && settings.nonWorkingDates.length > 0) {
        const dateStr = date.toISOString().split('T')[0];
        if (settings.nonWorkingDates.includes(dateStr)) {
            return false;
        }
    }

    return true;
};

module.exports = {
    generateDueDates,
    getNextDueDate,
    handleDailyFrequency,
    handleWeeklyFrequency,
    handleBiweeklyFrequency,
    handleMonthlyFrequency,
    adjustForWorkingDays,
    isWorkingDay
};
