const mongoose = require('mongoose');
require('dotenv').config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Loan = require('./models/Loan');

        const loan = (await Loan.find({})).find(l => l._id.toString().endsWith('3ed3b3'));
        if (!loan) throw new Error("Loan not found");

        console.log("--- RESETTING QUOTA AMOUNTS AND EXTENDING SCHEDULE FOR #3ed3b3 ---");

        const targetTotalPending = 23997.94;
        const originalQuotaAmount = 4999.84;
        const pRatio = 3773.46 / 4999.84;
        const iRatio = 1 - pRatio;

        // Quotas Q11 to Q14 (indices 10 to 13)
        // Q11 (index 10) is already partially paid (1001.44)
        const partialPaidInQ11 = 1001.44;

        // Reset Q11, Q12, Q13, Q14
        const indices = [10, 11, 12, 13];
        indices.forEach(idx => {
            const q = loan.schedule[idx];
            q.amount = mongoose.Types.Decimal128.fromString(originalQuotaAmount.toFixed(2));
            q.principalAmount = mongoose.Types.Decimal128.fromString((originalQuotaAmount * pRatio).toFixed(2));
            q.interestAmount = mongoose.Types.Decimal128.fromString((originalQuotaAmount * iRatio).toFixed(2));
            q.capital = q.principalAmount;
            q.interest = q.interestAmount;

            if (idx === 10) {
                q.status = 'partial';
                q.paidAmount = mongoose.Types.Decimal128.fromString(partialPaidInQ11.toFixed(2));
            } else {
                q.status = 'pending';
                q.paidAmount = mongoose.Types.Decimal128.fromString("0.00");
            }
            console.log(`Q${idx + 1} reset to ${originalQuotaAmount}`);
        });

        // Calculate current sum in schedule
        // Q11 remaining: 4999.84 - 1001.44 = 3998.40
        // Q12, Q13, Q14: 3 * 4999.84 = 14999.52
        // Total = 18997.92
        // Needed for target 23997.94: 5000.02

        const remainingToMatch = targetTotalPending - 18997.92;
        console.log(`Remaining balance to cover in Q15: ${remainingToMatch}`);

        // Add Q15
        const lastQuotaDate = new Date(loan.schedule[13].dueDate);
        const q15Date = new Date(lastQuotaDate);
        q15Date.setDate(q15Date.getDate() + 7);

        const q15 = {
            number: 15,
            dueDate: q15Date,
            amount: mongoose.Types.Decimal128.fromString(remainingToMatch.toFixed(2)),
            principalAmount: mongoose.Types.Decimal128.fromString((remainingToMatch * pRatio).toFixed(2)),
            interestAmount: mongoose.Types.Decimal128.fromString((remainingToMatch * iRatio).toFixed(2)),
            status: 'pending',
            paidAmount: mongoose.Types.Decimal128.fromString("0.00"),
            notes: ""
        };
        // Compatibility fields
        q15.capital = q15.principalAmount;
        q15.interest = q15.interestAmount;

        loan.schedule.push(q15);
        loan.duration = 15;
        console.log(`Q15 added for ${remainingToMatch.toFixed(2)} on ${q15Date.toISOString()}`);

        await loan.save({ validateBeforeSave: false });
        console.log("Loan #3ed3b3 corrected successfully.");

        process.exit(0);
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
};

run();
