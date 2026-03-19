const mongoose = require('mongoose');
require('dotenv').config();

const audit = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Client = require('./models/Client');
        const Transaction = require('./models/Transaction');
        const Loan = require('./models/Loan');

        const loans = await Loan.find({ status: { $ne: 'archived' } }).populate('clientId');
        console.log(`Auditing ${loans.length} active loans for Payment vs System discrepancies...`);

        const getVal = (v) => v ? (v.$numberDecimal ? parseFloat(v.$numberDecimal) : (parseFloat(v) || 0)) : 0;

        const results = [];

        for (const loan of loans) {
            const shortId = loan._id.toString().slice(-6);

            // 1. Calculate Expected Payments from DB Transactions
            const txs = await Transaction.find({
                $or: [
                    { loan: loan._id },
                    { loanV2: loan._id },
                    { loanV3: loan._id },
                    { "metadata.loanId": loan._id.toString() }
                ],
                type: 'in_payment'
            });
            const totalCollected = txs.reduce((sum, t) => sum + t.amount, 0);

            // 2. Calculate Original Principal + Projected Interest
            // From first regular installment
            const firstRegular = loan.schedule.find(q => !(q.notes && q.notes.includes("[Penalidad Applicable]")));
            if (!firstRegular) continue;

            const qAmt = getVal(firstRegular.amount);
            const initialDur = loan.initialDuration || (loan.schedule.length - loan.schedule.filter(q => q.notes && q.notes.includes("[Penalidad Aplicada]")).length);

            const originalTotalPI = qAmt * initialDur;

            // Penalties (shifts) add to the debt total but not to the "Principal/Interest" reduction normally.
            const penaltiesCollected = txs.filter(t => t.metadata?.concept === 'penalty_shift' || t.description?.includes('Penalidad') || t.notes?.includes('Penalidad')).reduce((s, t) => s + t.amount, 0);

            // The balance should be (Original Total PI) - (Collected minus Penalties)
            const correctBalance = originalTotalPI - (totalCollected - penaltiesCollected);

            const systemBalance = getVal(loan.currentCapital) + getVal(loan.financialModel?.interestPending);
            const diff = Math.abs(correctBalance - systemBalance);

            if (diff > 50) { // Significant diff (> 50 pesos)
                results.push({
                    id: shortId,
                    client: loan.clientId?.name || 'Unknown',
                    contractPI: originalTotalPI.toFixed(2),
                    collected: totalCollected.toFixed(2),
                    penalties: penaltiesCollected.toFixed(2),
                    calculated: correctBalance.toFixed(2),
                    system: systemBalance.toFixed(2),
                    diff: (correctBalance - systemBalance).toFixed(2),
                    installment: qAmt.toFixed(2)
                });
            }
        }

        if (results.length > 0) {
            console.log("Loans with Discrepancies between Transactions and System Balance:");
            console.table(results);
        } else {
            console.log("No systemic payment vs balance discrepancies found.");
        }

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
audit();
