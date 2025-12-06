const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');
const Loan = require('./models/Loan');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const restoreLoan = async () => {
    try {
        const loanId = '692d2c339ee6c7e138429116';
        const loan = await Loan.findById(loanId);

        if (!loan) {
            console.log('Loan not found');
            process.exit(1);
        }

        console.log(`Restoring loan ${loanId}...`);

        // 1. Delete ALL transactions
        const result = await Transaction.deleteMany({ loan: loanId });
        console.log(`Deleted ${result.deletedCount} transactions.`);

        // 2. Restore Schedule
        // Quotas 1-5: Paid
        // Quotas 6-8: Pending
        let totalPaid = 0;
        let totalCapitalPaid = 0;
        let totalInterestPaid = 0;

        loan.schedule.forEach(q => {
            if (q.number <= 5) {
                q.status = 'paid';
                q.paidAmount = q.amount;
                q.paidCapital = q.capital;
                q.paidInterest = q.interest;
                q.paidDate = new Date(q.dueDate); // Assume paid on due date

                totalPaid += q.amount;
                totalCapitalPaid += q.capital;
                totalInterestPaid += q.interest;
            } else {
                q.status = 'pending';
                q.paidAmount = 0;
                q.paidCapital = 0;
                q.paidInterest = 0;
                q.paidDate = null;
            }
        });

        // 3. Reset Loan Fields
        loan.paidLateFee = 0;
        loan.status = 'past_due'; // Because 6, 7, 8 are overdue (assuming today > Sep 1)

        // Recalculate Balance
        // For fixed loan, Balance = TotalToPay - TotalPaid
        // Or calculate from remaining quotas
        const remainingBalance = loan.schedule.reduce((acc, q) => {
            return acc + (q.amount - q.paidAmount);
        }, 0);

        loan.balance = remainingBalance;

        await loan.save();
        console.log(`Loan restored.`);
        console.log(`  Balance: ${loan.balance}`);
        console.log(`  Status: ${loan.status}`);
        console.log(`  Paid Quotas: 1-5`);
        console.log(`  Pending Quotas: 6-8`);

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

restoreLoan();
