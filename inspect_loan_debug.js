const mongoose = require('mongoose');
require('dotenv').config();

async function inspect() {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan');
    const Loan = require('./models/Loan');
    const PaymentV2 = require('./models/PaymentV2');

    const loan = await Loan.findOne({ _id: /.*3ed3b3$/ }); // Match by last 6 chars
    if (!loan) {
        console.log("Loan not found");
        process.exit(1);
    }

    console.log("--- LOAN DATA ---");
    console.log("ID:", loan._id);
    console.log("Status:", loan.status);
    console.log("Amount:", loan.amount);
    console.log("Current Capital:", loan.currentCapital);

    console.log("\n--- SCHEDULE ---");
    loan.schedule.forEach(q => {
        console.log(`${q.number} | ${q.dueDate.toISOString().split('T')[0]} | ${q.amount} | ${q.status} | Paid: ${q.paidAmount} | Notes: ${q.notes}`);
    });

    const payments = await PaymentV2.find({ loanId: loan._id }).sort({ date: 1 });
    console.log("\n--- PAYMENTS (PaymentV2) ---");
    payments.forEach(p => {
        console.log(`${p.date.toISOString().split('T')[0]} | ${p.amount} | ID: ${p._id} | Notes: ${p.notes}`);
    });

    process.exit(0);
}

inspect();
