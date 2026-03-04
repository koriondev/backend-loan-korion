require('dotenv').config();
const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Client = require('./models/Client');

async function run() {
    await mongoose.connect(process.env.MONGO_URI);
    const client = await Client.findOne({ name: /Arddeny/i });
    if (!client) return console.log('Client not found');
    const loan = await Loan.findOne({ clientId: client._id });

    console.log(`Initial Duration: ${loan.initialDuration}`);
    console.log(`Current Duration: ${loan.duration}`);
    console.log(`Amount (Prestado): ${loan.amount}`);
    console.log(`Interest Total: ${loan.financialModel?.interestTotal}`);

    let sum = 0;
    loan.schedule.forEach(q => { sum += parseFloat(q.amount.$numberDecimal || 0); });
    console.log(`Total Schedule Math: ${sum}`);

    process.exit(0);
}
run();
