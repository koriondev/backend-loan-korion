const mongoose = require('mongoose');
require('dotenv').config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Loan = require('./models/Loan');
        const { getNextDueDate } = require('./engines/amortizationEngine');

        const loan = await Loan.findById('69aa0417101cc07ac966b1d8');
        if (!loan) throw new Error("Loan not found");

        console.log("--- REPAIRING LOAN #66b1d8 ---");

        // 1. Shift the entire schedule forward by 1 month
        const frequency = loan.frequency || 'monthly';
        loan.schedule.forEach(q => {
            const oldDate = new Date(q.dueDate);
            const newDate = new Date(oldDate);
            newDate.setMonth(newDate.getMonth() + 1);

            // Re-apply holiday adjustment to be safe
            const { adjustToNextWorkingDay } = require('./engines/amortizationEngine');
            q.dueDate = adjustToNextWorkingDay(newDate);
            console.log(`Q${q.number} shifted from ${oldDate.toISOString().split('T')[0]} to ${q.dueDate.toISOString().split('T')[0]}`);
        });

        // 2. Remove Penalty
        loan.currentPenalty = 0;
        loan.pendingPenalty = 0;
        if (loan.penaltyConfig) {
            loan.penaltyConfig.calculatedPenalty = 0;
            loan.penaltyConfig.pendingPenalty = 0;
        }

        // 3. Reset Status and Arrears
        loan.status = 'active';
        loan.installmentsOverdue = 0;
        loan.daysLate = 0;

        // 4. Update internal dates
        loan.firstPaymentDate = loan.schedule[0].dueDate;

        await loan.save({ validateBeforeSave: false });
        console.log("Loan #66b1d8 repaired successfully.");

        process.exit(0);
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
};

run();
