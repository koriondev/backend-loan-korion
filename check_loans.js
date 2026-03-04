require('dotenv').config();
const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
const PaymentV2 = require('./models/PaymentV2');

async function run() {
    await mongoose.connect(process.env.MONGO_URI);
    const client = await Client.findOne({ name: /Arddeny/i });
    if (!client) return console.log('Client not found');

    const loan = await Loan.findOne({ clientId: client._id });
    console.log(`Loan ID: ${loan._id}`);
    console.log(`Loan Schedule Length: ${loan.schedule.length}`);
    console.log(`Loan Duration: ${loan.duration}`);

    console.log("--- SCHEDULE NOTES ---");
    loan.schedule.forEach((q, i) => {
        if (q.notes) console.log(`Quota ${i + 1}: ${q.notes} | Amount: ${q.amount} | Status: ${q.status}`);
    });

    const payments = await PaymentV2.find({ loanId: loan._id }).sort({ date: -1 });
    console.log("--- PAYMENTS ---");
    payments.forEach(p => {
        console.log(`Payment: ${p.amount} | Date: ${p.date} | Concept: ${p.metadata?.concept} | Notes: ${p.notes}`);
    });

    process.exit(0);
}

run();
