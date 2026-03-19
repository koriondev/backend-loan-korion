const mongoose = require('mongoose');
require('dotenv').config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const { generateScheduleV3, getNextDueDate } = require('./engines/amortizationEngine');

        console.log("--- VERIFYING DEFAULT DATE LOGIC ---");

        const startDate = new Date("2026-03-05");
        console.log(`Start Date: ${startDate.toISOString().split('T')[0]}`);

        const frequencies = ['weekly', 'monthly', 'daily'];

        frequencies.forEach(freq => {
            const nextDate = getNextDueDate(startDate, freq);
            console.log(`Frequency: ${freq} -> Default First Payment: ${nextDate.toISOString().split('T')[0]}`);
        });

        // Test with generateScheduleV3 simulated call like in controller
        const freq = 'monthly';
        const effectiveFirstPaymentDate = getNextDueDate(startDate, freq);

        const { schedule } = generateScheduleV3({
            amount: 10000,
            interestRateMonthly: 10,
            duration: 12,
            frequency: freq,
            lendingType: 'redito',
            startDate: startDate,
            firstPaymentDate: effectiveFirstPaymentDate
        });

        console.log(`Simulated Schedule Q1: ${schedule[0].dueDate.toISOString().split('T')[0]}`);

        if (schedule[0].dueDate.toISOString().split('T')[0] === "2026-04-06") { // 05/04 is Sunday
            console.log("VERIFICATION SUCCESSFUL: First payment is 1 month later (adjusted for Sunday).");
        } else {
            console.log("VERIFICATION FAILED: First payment date is incorrect.");
        }

        process.exit(0);
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
};

run();
