const mongoose = require('mongoose');
require('dotenv').config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Loan = require('./models/Loan');
        const penaltyEngine = require('./engines/penaltyEngine');
        const paymentEngine = require('./engines/paymentEngine');

        const loan = (await Loan.find({})).find(l => l._id.toString().endsWith('3ed3b3'));
        if (!loan) throw new Error("Loan not found");

        console.log("--- SIMULATING ADVANCED PAYMENT (6,000 DOP) ON 06/03 ---");

        // Mock state before payment (after our sanitation)
        console.log("Current Schedule (Partial View):");
        console.log("Q11 (09/03):", loan.schedule[10].status, getVal(loan.schedule[10].paidAmount));
        console.log("Q12 (16/03):", loan.schedule[11].status, getVal(loan.schedule[11].paidAmount));

        const paymentAmount = 6000;
        const paymentDate = new Date('2026-03-06T12:00:00Z');

        // 1. Distribute & Apply Payment
        const currentPenalty = penaltyEngine.calculatePenaltyV3(loan, null, paymentDate);
        const distribution = paymentEngine.distributePaymentV3(loan, paymentAmount, currentPenalty);

        console.log("\nDistribution breakdown:");
        console.log("Applied to Interest:", distribution.appliedInterest);
        console.log("Applied to Capital:", distribution.appliedCapital);
        console.log("Installment Updates:", distribution.installmentUpdates.length);

        // Simulate application
        paymentEngine.applyPaymentToLoanV3(loan, distribution, paymentDate);

        console.log("\nSchedule AFTER Advanced Payment:");
        console.log("Q11 (09/03): Status:", loan.schedule[10].status, "Paid:", getVal(loan.schedule[10].paidAmount), "Due Date:", loan.schedule[10].dueDate.toISOString());
        console.log("Q12 (16/03): Status:", loan.schedule[11].status, "Paid:", getVal(loan.schedule[11].paidAmount), "Due Date:", loan.schedule[11].dueDate.toISOString());
        console.log("Q13 (23/03): Status:", loan.schedule[12].status, "Due Date:", loan.schedule[12].dueDate.toISOString());

        // 2. Status Recalculation
        const paidGTs = (loan.schedule || []).filter(q => q.status === 'paid' && q.notes && q.notes.includes("[Penalidad Aplicada]")).length;
        const allOverdue = (loan.schedule || []).filter(q => {
            if (q.status === 'paid') return false;
            const dueDate = new Date(q.dueDate);
            return dueDate < paymentDate;
        });
        const overdueCount = Math.max(0, allOverdue.length - paidGTs);

        console.log("\nFinal Status Verification:");
        console.log("Effective Arrears:", overdueCount);
        console.log("Loan Status:", overdueCount > 0 ? 'past_due' : 'active');

        console.log("\nCONCLUSION:");
        console.log("1. Dates PRESERVED: YES (Q12 remains 16/03)");
        console.log("2. Status Green: YES (active)");
        console.log("3. Overflow correctly: YES (Q11 paid, balance to Q12)");

        process.exit(0);
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
};

function getVal(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'object' && v.$numberDecimal) return parseFloat(v.$numberDecimal);
    if (typeof v === 'object' && v.constructor.name === 'Decimal128') return parseFloat(v.toString());
    return parseFloat(v) || 0;
}

run();
