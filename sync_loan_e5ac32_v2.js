require('dotenv').config();
const mongoose = require('mongoose');
const Loan = require('./models/Loan');

const getD = (val) => {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'object' && val.$numberDecimal) return parseFloat(val.$numberDecimal);
    if (typeof val === 'object' && val.constructor.name === 'Decimal128') return parseFloat(val.toString());
    return parseFloat(val) || 0;
};

const toD128 = (val) => mongoose.Types.Decimal128.fromString(parseFloat(val || 0).toFixed(2));

async function sync() {
    await mongoose.connect(process.env.MONGO_URI, { dbName: 'test' });

    const loanId = new mongoose.Types.ObjectId('69307dbb85ad04f8c6e5ac32');
    const loan = await Loan.findById(loanId);

    const Transaction = require('./models/Transaction');
    const txs = await Transaction.find({
        client: loan.clientId,
        $or: [
            { loanV3: loan._id },
            { description: { $regex: loan._id.toString().slice(-6) } }
        ],
        category: { $in: ['Pago Préstamo', 'Otros Cargos'] },
        isArchived: { $ne: true }
    }).sort({ date: 1 });

    // 1. Reset Schedule
    loan.schedule.forEach(q => {
        q.paidAmount = toD128(0);
        q.capitalPaid = toD128(0);
        q.interestPaid = toD128(0);
        q.status = 'pending';
        q.paidDate = null;
        q.notes = "";
    });

    // 2. Reset Financial Model
    loan.financialModel.interestPaid = 0;
    loan.currentCapital = getD(loan.amount);
    if (loan.penaltyConfig) {
        loan.penaltyConfig.paidPenalty = 0;
    }

    let totalInterestPaid = 0;
    let totalCapitalPaid = 0;
    let totalPenaltyPaid = 0;

    for (const t of txs) {
        let remaining = getD(t.amount);

        // Match Penalty explicitly
        if (t.category === 'Otros Cargos' || t.description.includes('Penalidad')) {
            totalPenaltyPaid += remaining;
            console.log(`Penalty Applied: ${remaining} (${t.date.toISOString()})`);
            continue;
        }

        // Match Regular Payment
        for (let q of loan.schedule) {
            if (remaining <= 0.01) break;
            if (q.status === 'paid') continue;

            // Quotas 1, 2, 3, 5, 6, 7 are 2200. Quota 4 is 1000.
            const quotaAmt = (q.number === 4) ? 1000 : 2200;
            const alreadyPaid = getD(q.paidAmount);
            const pending = quotaAmt - alreadyPaid;

            if (pending <= 0.01) continue;

            const toApply = Math.min(remaining, pending);
            const newPaid = alreadyPaid + toApply;

            q.paidAmount = toD128(newPaid);
            q.paidDate = t.date;

            if (newPaid >= quotaAmt - 0.05) {
                q.status = 'paid';
            } else {
                q.status = 'partial';
            }

            const interestComp = getD(q.interestAmount || q.interest || 533.33);
            const capitalComp = getD(q.principalAmount || q.capital || 1666.67);

            const currentInterestPaid = getD(q.interestPaid);
            const interestRemaining = Math.max(0, interestComp - currentInterestPaid);

            const qInterestPaid = Math.min(toApply, interestRemaining);
            const qCapitalPaid = toApply - qInterestPaid;

            q.interestPaid = toD128(getD(q.interestPaid) + qInterestPaid);
            q.capitalPaid = toD128(getD(q.capitalPaid) + qCapitalPaid);

            totalInterestPaid += qInterestPaid;
            totalCapitalPaid += qCapitalPaid;
            remaining -= toApply;
        }
    }

    loan.financialModel.interestPaid = totalInterestPaid;
    loan.currentCapital = getD(loan.amount) - totalCapitalPaid;
    if (loan.penaltyConfig) {
        loan.penaltyConfig.paidPenalty = totalPenaltyPaid;
    }

    // Ensure schedule items have required fields
    loan.schedule.forEach(q => {
        if (q.amount == null || getD(q.amount) === 0) {
            const amt = (q.number === 4) ? 1000 : 2200;
            q.amount = toD128(amt);
        }
        if (q.principalAmount == null) q.principalAmount = toD128(getD(q.amount) - getD(q.interest || 533.33));
        if (q.interestAmount == null) q.interestAmount = toD128(getD(q.interest || 533.33));
        if (q.balance == null) q.balance = toD128(10000 - (q.number * 1666.67)); // Rough estimate
    });

    if (loan.currentCapital <= 0.1) {
        loan.status = 'paid';
    } else {
        loan.status = 'active';
    }

    loan.markModified('schedule');
    loan.markModified('financialModel');
    loan.markModified('penaltyConfig');

    await loan.save({ validateBeforeSave: false });
    console.log("Loan synchronized successfully.");
    console.log(`Final Totals: Capital Paid=${10000 - loan.currentCapital}, Interest Paid=${loan.financialModel.interestPaid}, Penalty Paid=${loan.penaltyConfig.paidPenalty}`);

    await mongoose.disconnect();
}

sync().catch(console.error);
