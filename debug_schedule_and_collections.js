const mongoose = require('mongoose');
const Loan = require('./models/Loan');
require('dotenv').config({ path: './backend/.env' });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';
const LOAN_ID = '69291ce2f6d05b9b7f6cf6ad';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('Connected to MongoDB');

        const loan = await Loan.findById(LOAN_ID);

        console.log('\n--- Schedule Payments ---');
        let totalPaidCapital = 0;
        let totalPaidInterest = 0;

        loan.schedule.forEach(s => {
            if (s.paidAmount > 0) {
                console.log(`Installment ${s.number}: Paid ${s.paidAmount} (Int: ${s.paidInterest}, Cap: ${s.paidCapital}) Date: ${s.paidDate}`);
                totalPaidCapital += s.paidCapital || 0;
                totalPaidInterest += s.paidInterest || 0;
            }
        });

        console.log('\n--- Totals from Schedule ---');
        console.log('Total Paid Capital:', totalPaidCapital);
        console.log('Total Paid Interest:', totalPaidInterest);
        console.log('Loan Current Capital:', loan.currentCapital);
        console.log('Calculated Capital (Amount - TotalPaidCapital):', loan.amount - totalPaidCapital);

        console.log('\n--- Collections ---');
        const collections = await mongoose.connection.db.listCollections().toArray();
        collections.forEach(c => console.log(c.name));

        process.exit();
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
