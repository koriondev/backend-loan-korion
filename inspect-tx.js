require('dotenv').config();
const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');

const inspectLatest = async () => {
    try {
        const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';
        await mongoose.connect(MONGO_URI);
        console.log('🟢 Connected to MongoDB');

        const tx = await Transaction.findOne({ type: 'in_payment' }).sort({ date: -1 });

        if (!tx) {
            console.log('No payment transactions found.');
        } else {
            console.log('Latest Transaction:', {
                _id: tx._id,
                amount: tx.amount,
                date: tx.date,
                metadata: tx.metadata,
                description: tx.description
            });

            if (tx.metadata && tx.metadata.breakdown) {
                console.log('✅ Breakdown found:', tx.metadata.breakdown);
            } else {
                console.log('❌ Breakdown MISSING in metadata.');
            }
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

inspectLatest();
