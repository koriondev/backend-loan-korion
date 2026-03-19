const mongoose = require('mongoose');
require('dotenv').config();

// These are the 6 loans reported by the user
// We'll find them by their known suffixes using the transactions collection (fast)
const LOAN_SUFFIXES = ['e5b318', 'e5ac32', '918e05', 'cd605a', 'cd52a9', '1d8a59'];

async function run() {
    await mongoose.connect(process.env.MONGO_URI);
    const Loan = require('./models/Loan');
    const Transaction = require('./models/Transaction');

    function getVal(v) {
        if (!v) return 0;
        if (v.$numberDecimal !== undefined) return parseFloat(v.$numberDecimal);
        if (typeof v === 'object' && v.constructor && v.constructor.name === 'Decimal128') return parseFloat(v.toString());
        return parseFloat(v) || 0;
    }

    for (const suffix of LOAN_SUFFIXES) {
        console.log(`\n=== Auditing loan #${suffix} ===`);

        // Find all in_payment transactions
        const txPayments = await Transaction.find({
            description: new RegExp(suffix),
            type: 'in_payment'
        }).lean();

        const totalPaidFromTx = txPayments.reduce((s, t) => s + (Number(t.amount) || 0), 0);
        console.log(`  Transaction payments: ${txPayments.length} payments = RD$${totalPaidFromTx}`);

        // Find loan by explicit client loanId reference in the desembolso transaction
        const desembolso = await Transaction.findOne({
            description: new RegExp(suffix),
            type: 'out_loan'
        }).lean();

        if (!desembolso) { console.log('  No desembolso found'); continue; }

        // Try to find loan by client
        let loan = null;
        if (desembolso.client) {
            loan = await Loan.findOne({ clientId: desembolso.client }, null, { sort: { createdAt: -1 } }).lean();
        }

        if (!loan) {
            console.log(`  Could not find loan for ${suffix}`);
            continue;
        }

        console.log(`  Loan ID: ${loan._id} | Version: ${loan.version} | LendingType: ${loan.lendingType}`);
        console.log(`  Current Capital in DB: ${getVal(loan.currentCapital)}`);
        console.log(`  Original Amount: ${getVal(loan.amount)}`);

        // Calculate schedule totals
        const schedTotalPaid = (loan.schedule || []).reduce((s, q) => s + getVal(q.paidAmount), 0);
        const schedTotalAmount = (loan.schedule || []).reduce((s, q) => s + getVal(q.amount), 0);
        const schedInterestTotal = (loan.schedule || []).reduce((s, q) => s + getVal(q.interest || q.interestAmount || 0), 0);
        const schedCapitalPaid = (loan.schedule || []).reduce((s, q) => s + getVal(q.capitalPaid || 0), 0);

        console.log(`  Schedule total amount: RD$${schedTotalAmount.toFixed(2)}`);
        console.log(`  Schedule paid total:   RD$${schedTotalPaid.toFixed(2)}`);
        console.log(`  Q count: ${(loan.schedule || []).length}`);

        // Print each quota
        (loan.schedule || []).forEach(q => {
            const amt = getVal(q.amount);
            const paid = getVal(q.paidAmount);
            console.log(`    Q${q.number}: ${new Date(q.dueDate).toISOString().split('T')[0]} | amt=${amt} | paid=${paid} | status=${q.status}`);
        });

        console.log(`  === DISCREPANCY ===`);
        console.log(`  TX shows RD$${totalPaidFromTx} received but schedule shows only RD$${schedTotalPaid.toFixed(2)} applied`);
        console.log(`  GAP: RD$${(totalPaidFromTx - schedTotalPaid).toFixed(2)}`);
    }

    process.exit(0);
}

run().catch(e => { console.error('ERROR:', e); process.exit(1); });
