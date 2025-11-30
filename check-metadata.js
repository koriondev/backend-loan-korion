require('dotenv').config();
const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');

const checkMetadata = async () => {
    try {
        const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';
        await mongoose.connect(MONGO_URI);
        console.log('🟢 Connected to MongoDB');

        const tx = await Transaction.findOne({ type: 'in_payment' }).sort({ date: -1 });
        if (tx) {
            console.log('Latest Payment Transaction:', tx);
            console.log('Metadata:', tx.metadata); // This might be undefined if not in schema
            console.log('Raw Metadata:', tx._doc.metadata); // Access raw document to bypass schema
        } else {
            console.log('No payment transactions found.');
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

checkMetadata();
