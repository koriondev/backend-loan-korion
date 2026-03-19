const mongoose = require('mongoose');
require('dotenv').config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Loan = require('./models/Loan');
        const Transaction = require('./models/Transaction');

        const loan = (await Loan.find({})).find(l => l._id.toString().endsWith('3ed3b3'));
        if (!loan) throw new Error("Loan not found");

        console.log("--- SPECIAL FIX FOR #3ed3b3 ---");

        // 1. Ensure 15 installments
        if (loan.schedule.length < 15) {
            const originalQuota = 4999.84;
            const pRatio = 3773.46 / 4999.84;
            const iRatio = 1 - pRatio;

            const lastQ = loan.schedule[loan.schedule.length - 1];
            const nextDate = new Date(lastQ.dueDate);
            nextDate.setDate(nextDate.getDate() + 7);

            loan.schedule.push({
                number: 15,
                dueDate: nextDate,
                amount: mongoose.Types.Decimal128.fromString(originalQuota.toFixed(2)),
                principalAmount: mongoose.Types.Decimal128.fromString((originalQuota * pRatio).toFixed(2)),
                interestAmount: mongoose.Types.Decimal128.fromString((originalQuota * iRatio).toFixed(2)),
                balance: mongoose.Types.Decimal128.fromString("0.00"),
                status: 'pending',
                paidAmount: mongoose.Types.Decimal128.fromString("0.00"),
                capitalPaid: mongoose.Types.Decimal128.fromString("0.00"),
                interestPaid: mongoose.Types.Decimal128.fromString("0.00")
            });
            loan.duration = 15;
            console.log("Increased duration to 15.");
        }

        // 2. Locate the "missing" payment of 01/03/2026
        // It was found earlier linked to client 6927dcee312573d65d1d4281 but loan 6946fa87f2908a680277d485
        const tx = await Transaction.findOne({
            client: loan.clientId,
            amount: 5000,
            date: { $gte: new Date("2026-03-01"), $lt: new Date("2026-03-02") }
        });

        if (tx) {
            console.log("Found transaction of 01/03/2026. Re-linking to this loan.");
            tx.loanV3 = loan._id;
            tx.metadata = tx.metadata || {};
            tx.metadata.loanId = loan._id;
            // Also need to set the breakdown if it's missing or wrong
            // Based on typical payments: Capital 3773.46, Interest 1226.54
            tx.metadata.breakdown = {
                appliedCapital: 3773.46,
                appliedInterest: 1226.54,
                appliedPenalty: 0
            };
            await tx.save();
        } else {
            console.log("Transaction of 01/03/2026 not found by date range.");
        }

        // 3. Now perform a full re-sync from all linked transactions
        const txs = await Transaction.find({
            $or: [
                { loan: loan._id },
                { loanV2: loan._id },
                { loanV3: loan._id },
                { "metadata.loanId": loan._id.toString() }
            ],
            type: 'in_payment'
        }).sort({ date: 1 });

        console.log(`Processing ${txs.length} total payments.`);

        // Reset schedule
        loan.schedule.forEach(q => {
            q.status = 'pending';
            q.paidAmount = mongoose.Types.Decimal128.fromString("0.00");
            q.capitalPaid = mongoose.Types.Decimal128.fromString("0.00");
            q.interestPaid = mongoose.Types.Decimal128.fromString("0.00");
            q.penaltyPaid = mongoose.Types.Decimal128.fromString("0.00");
            q.paidDate = null;
        });

        const pRatioGlobal = 3773.46 / 4999.84;
        const iRatioGlobal = 1 - pRatioGlobal;

        txs.forEach(t => {
            let remains = t.amount;
            for (let q of loan.schedule) {
                if (remains <= 0) break;
                const qAmt = parseFloat(q.amount.toString());
                const qPaid = parseFloat(q.paidAmount.toString());
                const qPend = qAmt - qPaid;
                if (qPend > 0) {
                    const toApply = Math.min(remains, qPend);
                    const isPenalty = q.number === 10;
                    if (isPenalty) {
                        q.interestPaid = mongoose.Types.Decimal128.fromString((parseFloat(q.interestPaid.toString()) + toApply).toFixed(2));
                    } else {
                        q.capitalPaid = mongoose.Types.Decimal128.fromString((parseFloat(q.capitalPaid.toString()) + (toApply * pRatioGlobal)).toFixed(2));
                        q.interestPaid = mongoose.Types.Decimal128.fromString((parseFloat(q.interestPaid.toString()) + (toApply * iRatioGlobal)).toFixed(2));
                    }
                    q.paidAmount = mongoose.Types.Decimal128.fromString((qPaid + toApply).toFixed(2));
                    if (parseFloat(q.paidAmount.toString()) >= qAmt - 0.05) {
                        q.status = 'paid';
                        q.paidDate = t.date;
                    } else {
                        q.status = 'partial';
                    }
                    remains -= toApply;
                }
            }
        });

        // 4. Update aggregates
        let pendingPrincipal = 0;
        let pendingInterest = 0;
        let totalInterestPaid = 0;
        loan.schedule.forEach(q => {
            const amt = parseFloat(q.amount.toString());
            const paid = parseFloat(q.paidAmount.toString());
            totalInterestPaid += parseFloat(q.interestPaid.toString());
            if (q.status !== 'paid') {
                const pend = amt - paid;
                if (q.number === 10) {
                    pendingInterest += pend;
                } else {
                    pendingPrincipal += pend * pRatioGlobal;
                    pendingInterest += pend * iRatioGlobal;
                }
            }
        });

        loan.currentCapital = pendingPrincipal;
        loan.financialModel.interestPending = pendingInterest;
        loan.financialModel.interestPaid = totalInterestPaid;

        console.log("FINAL Total Pending (P+I):", (pendingPrincipal + pendingInterest).toFixed(2));

        loan.markModified('schedule');
        loan.markModified('financialModel');
        await loan.save({ validateBeforeSave: false });

        console.log("Done.");
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
run();
