const mongoose = require('mongoose');
require('dotenv').config();

const sync = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Client = require('./models/Client');
        const Transaction = require('./models/Transaction');
        const Loan = require('./models/Loan');

        const loans = await Loan.find({ status: { $ne: 'archived' } }).populate('clientId');
        console.log(`Starting Mass Sync Repair for ${loans.length} loans...`);

        const getVal = (v) => v ? (v.$numberDecimal ? parseFloat(v.$numberDecimal) : (parseFloat(v) || 0)) : 0;
        const toDecimal = (v) => mongoose.Types.Decimal128.fromString(parseFloat(v).toFixed(2));

        let repairedCount = 0;

        for (const loan of loans) {
            const shortId = loan._id.toString().slice(-6);

            // 1. Get ALL associated in_payment transactions
            const txs = await Transaction.find({
                $or: [
                    { loan: loan._id },
                    { loanV2: loan._id },
                    { loanV3: loan._id },
                    { "metadata.loanId": loan._id.toString() }
                ],
                type: 'in_payment'
            }).sort({ date: 1 });

            // 2. Determine "Contract Integrity"
            // We need to know:
            // a) Regular Quota Amount
            // b) Expected Duration (including shifts)
            const schedule = loan.schedule || [];
            const regularQuotas = schedule.filter(q => !(q.notes && q.notes.includes("[Penalidad Aplicada]")));
            if (regularQuotas.length === 0) continue;

            const baseQ = regularQuotas[0];
            const qAmt = getVal(baseQ.amount);
            const pRatio = getVal(baseQ.principalAmount || baseQ.capital) / qAmt;
            const iRatio = 1 - pRatio;

            // 3. Rebuild Schedule according to "Gana Tiempo" counters
            const currentShiftCount = schedule.filter(q => q.notes && q.notes.includes("[Penalidad Aplicada]")).length;
            const initialDur = loan.initialDuration || (schedule.length - currentShiftCount);

            const totalRequiredInstallments = initialDur + currentShiftCount;

            // If schedule is truncated, add the missing ones at the end
            while (loan.schedule.length < totalRequiredInstallments) {
                const lastQ = loan.schedule[loan.schedule.length - 1];
                const nextDate = new Date(lastQ.dueDate);
                nextDate.setDate(nextDate.getDate() + 7); // Assuming weekly fallback if logic missing, better than nothing

                loan.schedule.push({
                    number: loan.schedule.length + 1,
                    dueDate: nextDate,
                    amount: toDecimal(qAmt),
                    principalAmount: toDecimal(qAmt * pRatio),
                    interestAmount: toDecimal(qAmt * iRatio),
                    balance: toDecimal(0),
                    status: 'pending',
                    paidAmount: toDecimal(0),
                    capitalPaid: toDecimal(0),
                    interestPaid: toDecimal(0)
                });
            }
            loan.duration = loan.schedule.length;

            // 4. Reset statuses and RE-APPLY ALL PAYMENTS
            loan.schedule.forEach(q => {
                q.status = 'pending';
                q.paidAmount = toDecimal(0);
                q.capitalPaid = toDecimal(0);
                q.interestPaid = toDecimal(0);
                q.penaltyPaid = toDecimal(0);
                q.paidDate = null;
            });

            txs.forEach(t => {
                let remains = t.amount;
                // Detect if it's a penalty payment (Gana Tiempo)
                const isManualPenalty = t.metadata?.concept === 'penalty_shift' || t.description?.includes('Penalidad') || t.notes?.includes('Penalidad');

                for (let q of loan.schedule) {
                    if (remains <= 0.01) break;

                    const qAmtVal = getVal(q.amount);
                    const qPaidVal = getVal(q.paidAmount);
                    const qPend = qAmtVal - qPaidVal;

                    if (qPend > 0.01) {
                        const isPenaltyQuota = q.notes && q.notes.includes("[Penalidad Aplicada]");

                        // Heuristic: If we have a penalty payment, try to apply to penalty quota first
                        // If we have a regular payment, try to avoid penalty quotas unless they are next
                        if (isManualPenalty && !isPenaltyQuota) continue;

                        const toApply = Math.min(remains, qPend);

                        if (isPenaltyQuota) {
                            q.interestPaid = toDecimal(getVal(q.interestPaid) + toApply);
                        } else {
                            q.capitalPaid = toDecimal(getVal(q.capitalPaid) + (toApply * pRatio));
                            q.interestPaid = toDecimal(getVal(q.interestPaid) + (toApply * iRatio));
                        }

                        q.paidAmount = toDecimal(qPaidVal + toApply);
                        if (getVal(q.paidAmount) >= qAmtVal - 0.05) {
                            q.status = 'paid'; q.paidDate = t.date;
                        } else {
                            q.status = 'partial';
                        }
                        remains -= toApply;
                        if (isManualPenalty) break; // One penalty payment per penalty quota
                    }
                }
            });

            // 5. Final Aggregates Synchronization
            let totalCapPaid = 0;
            let totalIntPaid = 0;
            let totalIntPending = 0;

            loan.schedule.forEach(q => {
                totalCapPaid += getVal(q.capitalPaid);
                totalIntPaid += getVal(q.interestPaid);
                if (q.status !== 'paid') {
                    const qTotal = getVal(q.amount);
                    const qPaid = getVal(q.paidAmount);
                    if (q.notes && q.notes.includes("[Penalidad Aplicada]")) {
                        totalIntPending += (qTotal - qPaid);
                    } else {
                        totalIntPending += (qTotal - qPaid) * iRatio;
                    }
                }
            });

            loan.currentCapital = Math.max(0, loan.amount - totalCapPaid);
            if (!loan.financialModel) loan.financialModel = {};
            loan.financialModel.interestPaid = totalIntPaid;
            loan.financialModel.interestPending = totalIntPending;

            // Sync legacy fields
            loan.balance = loan.currentCapital + totalIntPending;
            loan.realBalance = loan.currentCapital + totalIntPending;

            loan.markModified('schedule');
            loan.markModified('financialModel');
            await loan.save({ validateBeforeSave: false });
            repairedCount++;
            console.log(`[OK] ${shortId} synced. New Balance: ${(loan.currentCapital + totalIntPending).toFixed(2)}`);
        }

        console.log(`\nDONE. Processed ${repairedCount} loans.`);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
sync();
