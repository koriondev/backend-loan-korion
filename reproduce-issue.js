require('dotenv').config();
const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');
const Loan = require('./models/Loan');
const Client = require('./models/Client');

const reproduce = async () => {
    try {
        const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';
        await mongoose.connect(MONGO_URI);
        console.log('🟢 Connected to MongoDB');

        // 1. Fetch latest payment transaction
        const tx = await Transaction.findOne({ type: 'in_payment' }).populate('client').sort({ date: -1 });

        if (!tx) {
            console.log('No payment transactions found.');
            process.exit(0);
        }

        console.log('Transaction:', {
            _id: tx._id,
            description: tx.description,
            metadata: tx.metadata,
            client: tx.client ? tx.client.name : 'None'
        });

        let loanId = tx.metadata?.loanId;

        // Simulate Frontend Logic
        if (!loanId && tx.description) {
            console.log('Metadata missing. Trying regex...');
            const match = tx.description.match(/#([a-f0-9]{6})/);
            if (match) {
                console.log(`Regex matched: ${match[1]}`);

                // Simulate fetching all loans (since backend ignores client filter)
                const allLoans = await Loan.find({ businessId: tx.businessId });
                console.log(`Fetched ${allLoans.length} loans.`);

                const found = allLoans.find(l => l._id.toString().slice(-6) === match[1]);
                if (found) {
                    console.log(`Found loan via regex: ${found._id}`);
                    loanId = found._id;
                } else {
                    console.log('Loan NOT found via regex.');
                }
            } else {
                console.log('Regex did NOT match.');
            }
        } else {
            console.log('Metadata found or description missing.');
        }

        if (!loanId) {
            console.log('❌ Failed to identify loan ID.');
        } else {
            console.log(`✅ Identified Loan ID: ${loanId}`);

            // Simulate fetching loan details
            const loan = await Loan.findById(loanId);
            if (loan) {
                console.log('✅ Loan fetched successfully:', loan._id);
            } else {
                console.log('❌ Loan fetch returned null (404).');
            }
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

reproduce();
