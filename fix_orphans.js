const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const fixOrphans = async () => {
    try {
        // Find transactions with type 'in_payment' but no 'loan' field
        // But they MUST have metadata.loanId
        const orphans = await Transaction.find({
            type: 'in_payment',
            loan: { $exists: false },
            'metadata.loanId': { $exists: true }
        });

        console.log(`Found ${orphans.length} orphaned transactions.`);

        let fixedCount = 0;
        for (const tx of orphans) {
            const loanId = tx.metadata.loanId;
            if (loanId) {
                tx.loan = loanId;
                await tx.save();
                console.log(`✅ Fixed Tx ${tx._id} -> Linked to Loan ${loanId}`);
                fixedCount++;
            }
        }

        console.log(`\nSuccessfully fixed ${fixedCount} transactions.`);
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

fixOrphans();
