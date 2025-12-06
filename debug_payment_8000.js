const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');
const Loan = require('./models/Loan');
require('dotenv').config({ path: './backend/.env' });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';
const LOAN_ID = '69291ce2f6d05b9b7f6cf6ad';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('Connected to MongoDB');

        // Find the transaction of 8000
        const transactions = await Transaction.find({
            loan: LOAN_ID,
            amount: 8000
        });

        console.log(`Found ${transactions.length} transactions of 8000:`);
        transactions.forEach(t => {
            console.log(JSON.stringify(t, null, 2));
        });

        // Also check the loan state again
        const loan = await Loan.findById(LOAN_ID);
        console.log('\nLoan State:');
        console.log('Paid Late Fee:', loan.paidLateFee);
        console.log('Accumulated Capital Abone:', loan.accumulatedCapitalAbone);
        console.log('Current Capital:', loan.currentCapital);
        console.log('Balance:', loan.balance);

        process.exit();
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
