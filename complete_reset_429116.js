const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');
const Loan = require('./models/Loan');
const Wallet = require('./models/Wallet');
const Client = require('./models/Client');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const completeReset = async () => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const loanId = '692d2c339ee6c7e138429116';
        const loan = await Loan.findById(loanId).session(session);

        if (!loan) {
            console.log('Loan not found');
            process.exit(1);
        }

        const user = await User.findOne({ businessId: loan.businessId });
        console.log(`Resetting loan ${loanId} for business ${loan.businessId}...`);

        // 1. Delete ALL transactions for this loan
        const deletedTxs = await Transaction.deleteMany({
            $or: [
                { loan: loanId },
                { 'metadata.loanId': loanId.toString() }
            ]
        }).session(session);
        console.log(`Deleted ${deletedTxs.deletedCount} transactions.`);

        // 2. Restore Schedule: Quotas 1-5 paid, 6-8 pending
        loan.schedule.forEach(q => {
            if (q.number <= 5) {
                q.status = 'paid';
                q.paidAmount = q.amount;
                q.paidCapital = q.capital;
                q.paidInterest = q.interest;
                q.paidDate = new Date(q.dueDate);
            } else {
                q.status = 'pending';
                q.paidAmount = 0;
                q.paidCapital = 0;
                q.paidInterest = 0;
                q.paidDate = null;
            }
        });

        // 3. Reset fields
        loan.paidLateFee = 0;
        loan.status = 'past_due';

        // Recalculate balance from scratch
        const remainingBalance = loan.schedule.reduce((acc, q) => {
            return acc + (q.amount - q.paidAmount);
        }, 0);

        loan.balance = remainingBalance;

        await loan.save({ session });
        await session.commitTransaction();

        console.log(`✅ Loan restored successfully!`);
        console.log(`  Balance: RD$${loan.balance}`);
        console.log(`  Status: ${loan.status}`);
        console.log(`  Paid Late Fee: RD$${loan.paidLateFee}`);
        console.log(`  Paid Quotas: 1-5`);
        console.log(`  Pending Quotas: 6-8`);

        process.exit(0);
    } catch (error) {
        await session.abortTransaction();
        console.error(error);
        process.exit(1);
    } finally {
        session.endSession();
    }
};

completeReset();
