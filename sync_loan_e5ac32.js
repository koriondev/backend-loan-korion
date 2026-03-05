require('dotenv').config();
const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const PaymentV2 = require('./models/PaymentV2');

const getD = (val) => {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'object' && val.$numberDecimal) return parseFloat(val.$numberDecimal);
    if (typeof val === 'object' && val.constructor.name === 'Decimal128') return parseFloat(val.toString());
    return parseFloat(val) || 0;
};

const toD128 = (val) => mongoose.Types.Decimal128.fromString(parseFloat(val || 0).toFixed(2));

async function sync() {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI, { dbName: 'test' });
    console.log("Connected.");

    const loanId = new mongoose.Types.ObjectId('69307dbb85ad04f8c6e5ac32');
    const loan = await Loan.findById(loanId);
    if (!loan) {
        console.log("Loan not found");
        await mongoose.disconnect();
        return;
    }

    console.log(`Syncing Loan: ${loan._id} (Gregorio Tejeda)`);
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

    console.log(`Found ${txs.length} transactions to re-apply.`);

    // 1. Reset Schedule
    console.log("Resetting schedule...");
    loan.schedule.forEach(q => {
        q.paidAmount = toD128(0);
        q.capitalPaid = toD128(0);
        q.interestPaid = toD128(0);
        q.status = 'pending';
        q.paidDate = null;
        q.notes = "";
    });

    // 2. Reset Financial Model
    console.log("Resetting financial model...");
    loan.financialModel.interestPaid = 0;
    loan.currentCapital = getD(loan.amount);
    if (loan.penaltyConfig) {
        loan.penaltyConfig.paidPenalty = 0;
    }

    // 3. Re-apply transactions
    let totalInterestPaid = 0;
    let totalCapitalPaid = 0;
    let totalPenaltyPaid = 0;

    for (const t of txs) {
        console.log(`Applying tx: ${t.amount} (${t.date.toISOString()}) [${t.description}]`);

        let remaining = getD(t.amount);

        // Si es penalidad/otros cargos (Gana Tiempo)
        if (t.category === 'Otros Cargos' || t.description.includes('Penalidad')) {
            const q4 = loan.schedule.find(q => q.number === 4);
            if (q4) {
                q4.paidAmount = toD128(remaining);
                q4.status = 'paid';
                q4.paidDate = t.date;
                q4.notes = " [Penalidad Aplicada]";
                totalInterestPaid += remaining;
                totalPenaltyPaid += remaining;
            }
            continue;
        }

        // Pago regular
        for (let q of loan.schedule) {
            if (remaining <= 0.01) break;
            if (q.status === 'paid') continue;

            const quotaAmt = 2200; // Gregorio tiene cuotas de 2200
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

    // 4. Update Final Metrics
    loan.financialModel.interestPaid = totalInterestPaid;
    loan.currentCapital = getD(loan.amount) - totalCapitalPaid;
    if (loan.penaltyConfig) {
        loan.penaltyConfig.paidPenalty = totalPenaltyPaid;
    }

    // Fallbacks
    if (!loan.startDate) loan.startDate = loan.createdAt || new Date();
    if (!loan.firstPaymentDate) loan.firstPaymentDate = loan.schedule[0].dueDate;
    if (!loan.interestRateMonthly) loan.interestRateMonthly = 10;

    loan.schedule.forEach(q => {
        if (q.amount == null) q.amount = toD128(getD(q.capital || 0) + getD(q.interest || 0));
        if (q.principalAmount == null) q.principalAmount = toD128(getD(q.capital || 0));
        if (q.interestAmount == null) q.interestAmount = toD128(getD(q.interest || 0));
        if (q.balance == null) q.balance = toD128(getD(q.balance_after || 0));
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
    console.log(`Final Interest Paid: ${loan.financialModel.interestPaid}`);
    console.log(`Final Current Capital: ${loan.currentCapital}`);
    console.log(`Final Status: ${loan.status}`);

    await mongoose.disconnect();
}

sync().catch(console.error);
