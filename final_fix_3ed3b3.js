const mongoose = require('mongoose');
require('dotenv').config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Loan = require('./models/Loan');

        const loan = (await Loan.find({})).find(l => l._id.toString().endsWith('3ed3b3'));
        if (!loan) throw new Error("Loan not found");

        console.log("--- FINAL CORRECTION FOR #3ed3b3 (14 WEEKS, 5K QUOTA) ---");

        const originalQuotaAmount = 4999.84;
        const pRatio = 3773.46 / 4999.84;
        const iRatio = 1 - pRatio;

        // 1. Remove Q15 if exists
        loan.schedule = loan.schedule.slice(0, 14);
        loan.duration = 14;
        console.log("Schedule truncated to 14 rows.");

        // 2. Reset pending quotas (Q11-Q14)
        const partialPaidInQ11 = 1001.44;
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
                // We also need to split the paid amount into capitalPaid and interestPaid for V3 aggregates to make sense
                q.interestPaid = mongoose.Types.Decimal128.fromString((partialPaidInQ11 * iRatio).toFixed(2));
                q.capitalPaid = mongoose.Types.Decimal128.fromString((partialPaidInQ11 * pRatio).toFixed(2));
            } else {
                q.status = 'pending';
                q.paidAmount = mongoose.Types.Decimal128.fromString("0.00");
                q.capitalPaid = mongoose.Types.Decimal128.fromString("0.00");
                q.interestPaid = mongoose.Types.Decimal128.fromString("0.00");
            }
        });

        // 3. CORRECT AGGREGATES to match the 4 pending quotas
        // Principal pending = (Q11-Q14 total principal) - (Q11 capital paid)
        const totalPrincipalInLast4 = (originalQuotaAmount * pRatio) * 4;
        const totalInterestInLast4 = (originalQuotaAmount * iRatio) * 4;

        const capPaidIn11 = partialPaidInQ11 * pRatio;
        const intPaidIn11 = partialPaidInQ11 * iRatio;

        const correctCurrentCapital = totalPrincipalInLast4 - capPaidIn11;
        const correctInterestPending = totalInterestInLast4 - intPaidIn11;

        loan.currentCapital = mongoose.Types.Decimal128.fromString(correctCurrentCapital.toFixed(2));
        loan.financialModel.interestPending = mongoose.Types.Decimal128.fromString(correctInterestPending.toFixed(2));

        // Also update interestPaid to be consistent
        loan.financialModel.interestPaid = mongoose.Types.Decimal128.fromString((getVal(loan.financialModel.interestTotal) - correctInterestPending).toFixed(2));

        console.log(`New aggregates set: Capital=${loan.currentCapital}, InterestPending=${loan.financialModel.interestPending}`);
        console.log(`Total para saldar expected: ${(correctCurrentCapital + correctInterestPending).toFixed(2)}`);

        loan.markModified('schedule');
        loan.markModified('financialModel');
        await loan.save({ validateBeforeSave: false });
        console.log("Loan #3ed3b3 finalized successfully.");

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
