const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');
const Loan = require('./models/Loan');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const cleanupLoan = async () => {
    try {
        const loanId = '692d2c339ee6c7e138429116';
        const loan = await Loan.findById(loanId);

        if (!loan) {
            console.log('Loan not found');
            process.exit(1);
        }

        console.log(`Cleaning up loan ${loanId}...`);

        // 1. Delete ALL transactions for this loan
        const result = await Transaction.deleteMany({ loan: loanId });
        console.log(`Deleted ${result.deletedCount} transactions.`);

        // 2. Reset Loan Schedule and Balance
        console.log('Resetting Loan Schedule and Balance...');

        let newBalance = 0;
        loan.schedule.forEach(q => {
            q.status = 'pending';
            q.paidAmount = 0;
            q.paidCapital = 0;
            q.paidInterest = 0;
            q.paidDate = null;
            newBalance += q.amount;
        });

        // If it was 'redito', balance is just capital?
        if (loan.lendingType === 'redito') {
            loan.balance = loan.amount;
        } else {
            loan.balance = newBalance;
        }

        loan.status = 'past_due';

        await loan.save();
        console.log(`Loan reset. New Balance: ${loan.balance}`);

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

cleanupLoan();
