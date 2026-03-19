const mongoose = require('mongoose');
require('dotenv').config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Loan = require('./models/Loan');
        const Transaction = require('./models/Transaction');
        const { applyPaymentToLoan } = require('./engines/paymentEngine');

        const loan = (await Loan.find({})).find(l => l._id.toString().endsWith('3ed3b3'));
        if (!loan) throw new Error("Loan not found");

        console.log("--- RESTORING LOAN #3ed3b3 ---");

        // 1. Recover original terms
        const originalQuota = 4999.84;
        const pRatio = 3773.46 / 4999.84;
        const iRatio = 1 - pRatio;

        // 2. Identify all payments except the shift one
        const txs = await Transaction.find({
            $or: [
                { loan: loan._id },
                { loanV2: loan._id },
                { loanV3: loan._id },
                { "metadata.loanId": loan._id.toString() }
            ],
            type: 'in_payment'
        }).sort({ date: 1 });

        console.log(`Found ${txs.length} transactions.`);

        // 3. Reset schedule to clean state (including the shift result)
        // We know from history that one "Gana Tiempo" occurred on #10.
        // So we should have 15 installments total.

        // Let's rebuild the schedule structure first.
        // Q1-Q9: Regular
        // Q10: Penalty (1230)
        // Q11-Q15: Regular

        const newSchedule = [];
        let currentDate = new Date(loan.startDate);
        // Step forward to first payment
        // (Actually it's easier to copy existing and add one)

        // If we currently have 14, let's just add the 15th.
        if (loan.schedule.length < 15) {
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
            console.log("Added 15th installment.");
        }

        // 4. Reset all installments to 0 paid
        loan.schedule.forEach(q => {
            q.status = 'pending';
            q.paidAmount = mongoose.Types.Decimal128.fromString("0.00");
            q.capitalPaid = mongoose.Types.Decimal128.fromString("0.00");
            q.interestPaid = mongoose.Types.Decimal128.fromString("0.00");
            q.penaltyPaid = mongoose.Types.Decimal128.fromString("0.00");
            q.paidDate = null;
        });

        // 5. Re-apply transactions one by one
        // Note: The paymentEngine.applyPaymentToLoan expects a distribution object or it does its own.
        // For simplicity and total accuracy, I will manually apply the payments here following the same logic.

        txs.forEach(t => {
            let remaining = t.amount;
            console.log(`Applying payment of ${remaining} (${t.date.toISOString().split('T')[0]})`);

            for (let q of loan.schedule) {
                if (remaining <= 0) break;

                const qAmt = parseFloat(q.amount.toString());
                const qPaid = parseFloat(q.paidAmount.toString());
                const qPend = qAmt - qPaid;

                if (qPend > 0) {
                    const toApply = Math.min(remaining, qPend);

                    // Split toApply into capital and interest for the installment
                    // If it's the penalty installment (#10), it's all interest/penalty
                    const isPenalty = q.number === 10;

                    if (isPenalty) {
                        q.interestPaid = mongoose.Types.Decimal128.fromString((parseFloat(q.interestPaid.toString()) + toApply).toFixed(2));
                    } else {
                        q.capitalPaid = mongoose.Types.Decimal128.fromString((parseFloat(q.capitalPaid.toString()) + (toApply * pRatio)).toFixed(2));
                        q.interestPaid = mongoose.Types.Decimal128.fromString((parseFloat(q.interestPaid.toString()) + (toApply * iRatio)).toFixed(2));
                    }

                    q.paidAmount = mongoose.Types.Decimal128.fromString((qPaid + toApply).toFixed(2));
                    if (parseFloat(q.paidAmount.toString()) >= qAmt - 0.05) {
                        q.status = 'paid';
                        q.paidDate = t.date;
                    } else {
                        q.status = 'partial';
                    }

                    remaining -= toApply;
                }
            }
        });

        // 6. Recalculate Aggregates
        let totalPrincipalPaid = 0;
        let totalInterestPaid = 0;
        loan.schedule.forEach(q => {
            totalPrincipalPaid += parseFloat(q.capitalPaid.toString());
            totalInterestPaid += parseFloat(q.interestPaid.toString());
        });

        const originalPrincipal = 49055;
        loan.currentCapital = originalPrincipal - totalPrincipalPaid;

        if (!loan.financialModel) loan.financialModel = {};
        const originalInterest = 15942.94;
        // Total interest is adjusted by the 1230 penalty shift
        const totalInterestWithPenalty = originalInterest + 1230 - originalQuota * iRatio;
        // Wait, shifting pushing a quota pushes interest too. 
        // Actually the easiest is to sum pending installments.

        let pendingPrincipal = 0;
        let pendingInterest = 0;
        loan.schedule.forEach(q => {
            if (q.status !== 'paid') {
                const amt = parseFloat(q.amount.toString());
                const paid = parseFloat(q.paidAmount.toString());
                const pend = amt - paid;
                if (q.number === 10) {
                    pendingInterest += pend;
                } else {
                    pendingPrincipal += pend * pRatio;
                    pendingInterest += pend * iRatio;
                }
            }
        });

        loan.currentCapital = pendingPrincipal;
        loan.financialModel.interestPending = pendingInterest;
        loan.financialModel.interestPaid = totalInterestPaid;
        loan.duration = 15;

        console.log("New Balance (Principal):", pendingPrincipal);
        console.log("New Interest Pending:", pendingInterest);
        console.log("Total to satisfy:", pendingPrincipal + pendingInterest);

        loan.markModified('schedule');
        loan.markModified('financialModel');
        await loan.save({ validateBeforeSave: false });

        console.log("Loan #3ed3b3 successfully restored to 15 installments and re-balanced.");
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
run();
