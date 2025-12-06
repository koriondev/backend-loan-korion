const mongoose = require('mongoose');
const Loan = require('./models/Loan');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('Connected to MongoDB');

        const loans = await Loan.find({});
        console.log(`Found ${loans.length} loans to check.`);

        for (const loan of loans) {
            let totalPaidCapital = 0;
            if (loan.schedule && loan.schedule.length > 0) {
                totalPaidCapital = loan.schedule.reduce((acc, item) => acc + (item.paidCapital || 0), 0);
            }

            const calculatedCurrentCapital = loan.amount - totalPaidCapital;

            let needsUpdate = false;

            // Fix missing lendingType
            if (!loan.lendingType) {
                console.log(`Loan ${loan._id} missing lendingType. Setting to 'amortization'.`);
                loan.lendingType = 'amortization';
                needsUpdate = true;
            }

            // Update currentCapital if missing or different
            if (loan.currentCapital === undefined || Math.abs(loan.currentCapital - calculatedCurrentCapital) > 1) {
                console.log(`Updating Loan ${loan._id}: Amount=${loan.amount}, PaidCapital=${totalPaidCapital}, New CurrentCapital=${calculatedCurrentCapital}`);
                loan.currentCapital = calculatedCurrentCapital;
                needsUpdate = true;
            }

            if (needsUpdate) {
                await loan.save();
            }
        }

        console.log('Migration completed.');
        process.exit();
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
