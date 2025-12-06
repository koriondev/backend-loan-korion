const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
require('dotenv').config({ path: './backend/.env' });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('Connected to MongoDB');

        // 1. Find Client
        const client = await Client.findOne({ name: { $regex: /starlyn/i } });

        if (!client) {
            console.log('Client "Starlyn" not found');
            process.exit();
        }

        console.log(`Found Client: ${client.name} (${client._id})`);

        // 2. Find All Loans
        const loans = await Loan.find({ client: client._id });

        console.log(`Found ${loans.length} loans for this client.`);
        console.log('--------------------------------------------------');
        console.log('ID | Status | Amount | CurrentCapital | Balance');
        console.log('--------------------------------------------------');

        let totalAmount = 0;
        let totalCurrentCapital = 0;
        let totalBalance = 0;

        let activeAmount = 0;
        let activeCurrentCapital = 0;

        loans.forEach(loan => {
            console.log(`${loan._id} | ${loan.status} | ${loan.amount} | ${loan.currentCapital} | ${loan.balance}`);

            totalAmount += loan.amount;
            totalCurrentCapital += (loan.currentCapital || 0);
            totalBalance += (loan.balance || 0);

            if (['active', 'past_due'].includes(loan.status)) {
                activeAmount += loan.amount;
                activeCurrentCapital += (loan.currentCapital || 0);
            }
        });

        console.log('--------------------------------------------------');
        console.log(`Total Amount (All Loans): ${totalAmount}`);
        console.log(`Total Current Capital (All Loans): ${totalCurrentCapital}`);
        console.log(`Total Balance (All Loans): ${totalBalance}`);
        console.log('--------------------------------------------------');
        console.log(`Active + Past Due Amount: ${activeAmount}`);
        console.log(`Active + Past Due Current Capital: ${activeCurrentCapital}`);

        process.exit();
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
