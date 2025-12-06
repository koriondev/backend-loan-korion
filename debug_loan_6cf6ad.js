const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
require('dotenv').config({ path: './backend/.env' });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('Connected to MongoDB');

        // Fetch all loans and filter in JS because querying by partial ObjectId string is tricky in pure Mongo query without aggregation or string conversion
        const loans = await Loan.find().populate('client');

        const targetLoan = loans.find(l => l._id.toString().endsWith('6cf6ad'));

        if (!targetLoan) {
            console.log('Loan not found with ID ending in 6cf6ad');
        } else {
            console.log('Found Loan:', JSON.stringify(targetLoan, null, 2));

            // Check for obvious errors
            console.log('\n--- Analysis ---');
            console.log('ID:', targetLoan._id);
            console.log('Client:', targetLoan.client ? targetLoan.client.name : 'N/A');
            console.log('Status:', targetLoan.status);
            console.log('Balance:', targetLoan.balance);
            console.log('Total To Pay:', targetLoan.totalToPay);
            console.log('Schedule Length:', targetLoan.schedule.length);

            // Check schedule consistency
            let calcBalance = 0;
            targetLoan.schedule.forEach(s => {
                if (s.status !== 'paid') {
                    calcBalance += s.amount - (s.paidAmount || 0);
                }
            });
            console.log('Calculated Remaining Balance from Schedule:', calcBalance);
        }
        process.exit();
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
