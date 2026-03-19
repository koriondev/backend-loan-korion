const mongoose = require('mongoose');
require('dotenv').config();

const LOAN_ID = '69a49ada09f42130f72b5c5f';

async function run() {
    await mongoose.connect(process.env.MONGO_URI);
    const Loan = require('./models/Loan');

    function getVal(v) {
        if (!v) return 0;
        if (v.$numberDecimal) return parseFloat(v.$numberDecimal);
        if (v.constructor && v.constructor.name === 'Decimal128') return parseFloat(v.toString());
        return parseFloat(v) || 0;
    }

    const l = await Loan.findById(LOAN_ID).lean();
    if (!l) { console.log('Loan not found'); process.exit(1); }

    console.log('=== LOAN #e5bb64 ===');
    console.log('Status:', l.status, '| Version:', l.version);
    console.log('Overdue:', l.installmentsOverdue, '| DaysLate:', l.daysLate);
    console.log('CurrentPenalty:', getVal(l.currentPenalty));
    console.log('PendingPenalty:', getVal(l.pendingPenalty));
    console.log('PenaltyConfig:', JSON.stringify(l.penaltyConfig));
    console.log('LendingType:', l.lendingType, '| Frequency:', l.frequency);

    console.log('\n=== SCHEDULE ===');
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    (l.schedule || []).forEach(q => {
        const d = new Date(q.dueDate).toISOString().split('T')[0];
        const isOverdue = new Date(q.dueDate) < now && q.status !== 'paid';
        console.log(`Q${q.number}: ${d} | amt=${getVal(q.amount)} | paid=${getVal(q.paidAmount)} | status=${q.status}${isOverdue ? ' [OVERDUE]' : ''}`);
    });

    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
