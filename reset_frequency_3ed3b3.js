const mongoose = require('mongoose');
require('dotenv').config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Loan = require('./models/Loan');

        const loan = (await Loan.find({})).find(l => l._id.toString().endsWith('3ed3b3'));
        if (!loan) throw new Error("Loan not found");

        console.log("--- RESETTING FREQUENCY TO WEEKLY (7 DAYS) FOR #3ed3b3 ---");

        let currentDate = new Date('2025-12-29T00:00:00.000Z');

        for (let i = 0; i < loan.schedule.length; i++) {
            const oldDate = loan.schedule[i].dueDate;
            loan.schedule[i].dueDate = new Date(currentDate);
            console.log(`Q${i + 1}: ${oldDate.toISOString().split('T')[0]} -> ${loan.schedule[i].dueDate.toISOString().split('T')[0]}`);

            // Increment by 7 days
            currentDate.setDate(currentDate.getDate() + 7);
        }

        // Force StartDate and CreatedAt
        loan.startDate = new Date('2025-12-29T00:00:00.000Z');
        loan.createdAt = new Date('2025-12-29T00:00:00.000Z');

        // Recalculate status using GT Consumption Logic
        const now = new Date();
        now.setHours(0, 0, 0, 0);

        const paidGTs = (loan.schedule || []).filter(q => q.status === 'paid' && q.notes && q.notes.includes("[Penalidad Aplicada]")).length;
        const allOverdue = (loan.schedule || []).filter(q => {
            if (q.status === 'paid') return false;
            const dueDate = new Date(q.dueDate);
            return dueDate < now;
        });

        const overdueCount = Math.max(0, allOverdue.length - paidGTs);
        loan.installmentsOverdue = overdueCount;
        loan.status = overdueCount > 0 ? 'past_due' : 'active';
        loan.daysLate = 0;

        console.log("Final State -> Status:", loan.status, "Arrears:", loan.installmentsOverdue);

        await loan.save({ validateBeforeSave: false });
        console.log("Loan #3ed3b3 reset to weekly frequency successfully.");

        process.exit(0);
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
};

run();
