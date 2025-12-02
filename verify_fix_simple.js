const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Transaction = require('./models/Transaction');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const verify = async () => {
    try {
        const loan = await Loan.findById('6927dea4312573d65d1d429a');
        if (!loan) {
            console.log('Loan not found');
            process.exit(1);
        }
        console.log(`Loan found: ${loan._id}`);

        const tx = await Transaction.findById('69291abbf6d05b9b7f6ce7c6');
        console.log('Transaction:', tx);
        console.log('Tx Loan:', tx.loan);
        console.log('Tx Metadata:', tx.metadata);

        // The loan variable is already declared above, so we reuse it.
        // const loan = await Loan.findById('6927dea4312573d65d1d429a'); 
        console.log('Loan ID:', loan._id);

        console.log('Comparison:', tx.loan?.toString() === loan._id.toString());

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

verify();
