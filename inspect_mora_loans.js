const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Transaction = require('./models/Transaction');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const inspectLoans = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });
        const allLoans = await Loan.find({ businessId: user.businessId });

        const targetIds = ['1d721b', '1d4cdf'];

        for (const shortId of targetIds) {
            const loan = allLoans.find(l => l._id.toString().toLowerCase().endsWith(shortId.toLowerCase()));

            if (loan) {
                console.log(`\n═══════════════════════════════════════`);
                console.log(`PRÉSTAMO ${loan._id} (${shortId})`);
                console.log(`═══════════════════════════════════════`);
                console.log(`Late Fee (Loan Level): ${loan.lateFee}`);

                // Check Schedule for paid amounts
                console.log('📅 Schedule (Paid/Partial):');
                loan.schedule.filter(q => q.paidAmount > 0).forEach(q => {
                    console.log(`  #${q.number} - Paid: ${q.paidAmount} (Int: ${q.paidInterest}, Cap: ${q.paidCapital}) - Status: ${q.status}`);
                });

                // Check Transactions by Client
                if (loan.client) {
                    const transactions = await Transaction.find({
                        businessId: user.businessId,
                        client: loan.client._id,
                        type: 'in_payment'
                    }).sort({ date: -1 });

                    console.log(`💰 Transactions for Client ${loan.client.name} (${transactions.length}):`);
                    transactions.forEach(tx => {
                        console.log(`  ID: ${tx._id}`);
                        console.log(`  Date: ${new Date(tx.date).toLocaleDateString()}`);
                        console.log(`  Amount: ${tx.amount}`);
                        console.log(`  Breakdown:`, tx.metadata?.breakdown);
                        console.log(`  Loan ID in Metadata: ${tx.metadata?.loanId}`);
                        console.log('  ---');
                    });
                }

            } else {
                console.log(`❌ Loan ${shortId} not found`);
            }
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

inspectLoans();
