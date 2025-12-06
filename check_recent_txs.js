const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const checkRecentTransactions = async () => {
    try {
        // Get last 20 transactions
        const recentTxs = await Transaction.find({})
            .sort({ date: -1 })
            .limit(20);

        console.log(`Checking last ${recentTxs.length} transactions...`);

        let missingLoanCount = 0;
        let linkedLoanCount = 0;

        recentTxs.forEach(tx => {
            const hasLoan = !!tx.loan;
            const isPayment = tx.type === 'in_payment';

            if (isPayment) {
                console.log(`[${hasLoan ? 'LINKED' : 'UNLINKED'}] ${tx._id} - ${tx.description} - Amount: ${tx.amount}`);
                if (!hasLoan) missingLoanCount++;
                else linkedLoanCount++;
            }
        });

        console.log('\nSummary:');
        console.log(`Linked Payments: ${linkedLoanCount}`);
        console.log(`Unlinked Payments: ${missingLoanCount}`);

        if (missingLoanCount > 0) {
            console.log('❌ CONFIRMED: Multiple recent payments are missing the loan link.');
        } else {
            console.log('✅ No unlinked payments found in recent history.');
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

checkRecentTransactions();
