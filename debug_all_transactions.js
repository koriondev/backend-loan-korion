const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');
require('dotenv').config({ path: './backend/.env' });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';
const LOAN_ID = '69291ce2f6d05b9b7f6cf6ad';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('Connected to MongoDB');

        const transactions = await Transaction.find({ loan: LOAN_ID }).sort({ date: 1 });

        console.log(`Found ${transactions.length} transactions:`);
        transactions.forEach(t => {
            console.log(JSON.stringify(t, null, 2));
        });
        process.exit();
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
