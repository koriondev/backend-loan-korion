const mongoose = require('mongoose');
const PaymentV2 = require('./models/PaymentV2');
require('dotenv').config({ path: './backend/.env' });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';
const LOAN_ID = '69291ce2f6d05b9b7f6cf6ad';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('Connected to MongoDB');

        const payments = await PaymentV2.find({ loanId: LOAN_ID });

        console.log(`Found ${payments.length} payments in PaymentV2:`);
        payments.forEach(p => {
            console.log(JSON.stringify(p, null, 2));
        });
        process.exit();
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
