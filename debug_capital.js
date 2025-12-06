const mongoose = require('mongoose');
const Loan = require('./models/Loan');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('Connected to MongoDB');

        const activeLoans = await Loan.find({ status: 'active' });

        let totalAmount = 0;
        let totalCurrentCapital = 0;
        let totalBalance = 0;

        console.log('--- Active Loans ---');
        activeLoans.forEach(loan => {
            console.log(`Loan ${loan._id}: Amount=${loan.amount}, CurrentCapital=${loan.currentCapital}, Balance=${loan.balance}`);
            totalAmount += loan.amount;
            totalCurrentCapital += loan.currentCapital;
            totalBalance += loan.balance;
        });

        console.log('--------------------');
        console.log(`Total Original Amount (Lent): ${totalAmount}`);
        console.log(`Total Current Capital (Outstanding Principal): ${totalCurrentCapital}`);
        console.log(`Total Balance (Outstanding Principal + Interest): ${totalBalance}`);

        process.exit();
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
