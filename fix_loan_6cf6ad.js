const mongoose = require('mongoose');
const Loan = require('./models/Loan');
require('dotenv').config({ path: './backend/.env' });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';
const LOAN_ID = '69291ce2f6d05b9b7f6cf6ad';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('Connected to MongoDB');

        const loan = await Loan.findById(LOAN_ID);
        if (!loan) {
            console.error('Loan not found!');
            process.exit(1);
        }

        console.log('Found loan:', loan._id);
        console.log('Current Schedule Length:', loan.schedule.length);

        // Verify it is a redito loan with duration
        if (loan.lendingType !== 'redito' || loan.duration <= 0) {
            console.log('Loan is not a fixed-duration redito loan. No changes needed or manual check required.');
            process.exit(0);
        }

        // Update the last installment
        const lastInstallmentIndex = loan.schedule.length - 1;
        const lastInstallment = loan.schedule[lastInstallmentIndex];

        console.log('Old Last Installment:', JSON.stringify(lastInstallment, null, 2));

        // Add capital to the last installment
        lastInstallment.capital = loan.amount;
        lastInstallment.amount = lastInstallment.interest + loan.amount;

        console.log('New Last Installment:', JSON.stringify(lastInstallment, null, 2));

        // Update the schedule array
        loan.schedule[lastInstallmentIndex] = lastInstallment;

        // Mark modified because we are modifying an object inside an array
        loan.markModified('schedule');

        await loan.save();
        console.log('Loan updated successfully!');

        process.exit();
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
