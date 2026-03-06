const mongoose = require('mongoose');
require('dotenv').config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Loan = require('./models/Loan');
        const penaltyEngine = require('./engines/penaltyEngine');
        const Settings = require('./models/Settings');

        const loans = await Loan.find({ status: { $ne: 'archived' } });
        const loan = loans.find(x => x._id.toString().endsWith('3ed3b3'));
        if (!loan) throw new Error("Loan not found");

        const settings = await Settings.findOne({ businessId: loan.businessId });

        console.log("--- RECALCULATING LOAN #3ed3b3 ---");

        const now = new Date();
        now.setHours(0, 0, 0, 0);

        // 1. Calculate Penalty using new GT Consumption logic in penaltyEngine
        const penaltyData = penaltyEngine.calculatePenaltyV3(loan, settings);
        console.log("Penalty Data:", JSON.stringify(penaltyData, null, 2));

        // 2. Identify Overdue Installments using GT Consumption logic (replicated from recalculateLoan)
        const paidGTs = (loan.schedule || []).filter(q => q.status === 'paid' && q.notes && q.notes.includes("[Penalidad Aplicada]")).length;
        console.log("Paid GTs Count:", paidGTs);

        const allOverdue = (loan.schedule || []).filter(q => {
            if (q.status === 'paid') return false;
            const dueDate = new Date(q.dueDate);
            return dueDate < now;
        });
        console.log("All Overdue installments (raw):", allOverdue.length);

        const overdueInstallments = allOverdue.slice(paidGTs);
        console.log("Overdue installments after GT Consumption:", overdueInstallments.length);

        let daysLate = 0;
        if (overdueInstallments.length > 0) {
            const firstOverdue = overdueInstallments[0];
            const diffTime = Math.abs(now - new Date(firstOverdue.dueDate));
            daysLate = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }
        console.log("Days Late calculated:", daysLate);

        const targetStatus = overdueInstallments.length > 0 ? 'past_due' : 'active';
        console.log("Target Status:", targetStatus);

        console.log("\n--- UPDATING LOAN STATUS ---");
        loan.status = targetStatus;
        loan.daysLate = daysLate;
        loan.installmentsOverdue = overdueInstallments.length;
        loan.pendingPenalty = penaltyData.totalPenalty;

        await loan.save({ validateBeforeSave: false });
        console.log("Loan updated successfully with validateBeforeSave: false");

        process.exit(0);
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
};

run();
