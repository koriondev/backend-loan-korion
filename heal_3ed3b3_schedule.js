const mongoose = require('mongoose');
require('dotenv').config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Loan = require('./models/Loan');

        const loan = (await Loan.find({})).find(l => l._id.toString().endsWith('3ed3b3'));
        if (!loan) throw new Error("Loan not found");

        console.log("--- HEALING SCHEDULE FOR #3ed3b3 ---");

        const targetCapital = parseFloat(loan.currentCapital.toString()); // 18867.32
        const targetInterest = parseFloat(loan.financialModel.interestPending.toString()); // 5130.62
        const totalTarget = targetCapital + targetInterest; // 23997.94

        console.log(`Target Capital to recover in schedule: ${targetCapital}`);
        console.log(`Target Interest to recover in schedule: ${targetInterest}`);

        // We will redistribute the remaining capital into the 4 remaining quotas (Q11, Q12, Q13, Q14)
        // Indices 10, 11, 12, 13
        const remainingQuotas = [10, 11, 12, 13];

        // Let's reset their principal/interest to be consistent
        // Q11 is already partially paid (1001.44). We must account for that.
        // Total amount (principal + interest) for these 4 quotas must equal (23997.94 + 1001.44)
        const totalAmountToDistribute = totalTarget + 1001.44;
        const perQuota = totalAmountToDistribute / 4;

        console.log(`Distributing ${totalAmountToDistribute} over 4 quotas (${perQuota} each)`);

        remainingQuotas.forEach(idx => {
            const q = loan.schedule[idx];
            // Split perQuota into principal and interest (proportionally or just simple?)
            // Original proportions were ~3773.46 principal and ~1226.38 interest
            const pRatio = 3773.46 / 4999.84;
            const iRatio = 1 - pRatio;

            q.principalAmount = mongoose.Types.Decimal128.fromString((perQuota * pRatio).toFixed(2));
            q.interestAmount = mongoose.Types.Decimal128.fromString((perQuota * iRatio).toFixed(2));
            q.amount = mongoose.Types.Decimal128.fromString(perQuota.toFixed(2));

            // Recalculate interest/principal for this quota object if needed
            q.interest = q.interestAmount;
            q.capital = q.principalAmount;

            console.log(`Q${idx + 1} reset: Total=${q.amount}, Capital=${q.principalAmount}, Interest=${q.interestAmount}`);
        });

        // Recalculate status for each
        loan.schedule[10].status = 'partial'; // Q11
        loan.schedule[11].status = 'pending'; // Q12
        loan.schedule[12].status = 'pending'; // Q13
        loan.schedule[13].status = 'pending'; // Q14

        await loan.save({ validateBeforeSave: false });
        console.log("Schedule healed successfully.");

        process.exit(0);
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
};

run();
