const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Transaction = require('./models/Transaction');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const fixOrphans = async () => {
    try {
        const transactions = await Transaction.find({
            $or: [
                { loan: { $exists: false } },
                { loan: null }
            ]
        });

        console.log(`Found ${transactions.length} potential orphans.`);

        // Fetch all loans to match against
        const loans = await Loan.find({});

        let fixedCount = 0;

        for (const tx of transactions) {
            // Check if it has a description with "Préstamo #xxxxxx"
            const match = tx.description.match(/Préstamo #([a-f0-9]{6,})/i);
            
            let loanIdToLink = null;

            if (match) {
                const shortId = match[1];
                const loan = loans.find(l => l._id.toString().endsWith(shortId));
                if (loan) loanIdToLink = loan._id;
            } else if (tx.metadata && tx.metadata.loanId) {
                // If description doesn't match but metadata has ID, use it
                const loan = loans.find(l => l._id.toString() === tx.metadata.loanId.toString());
                if (loan) loanIdToLink = loan._id;
            }

            if (loanIdToLink) {
                console.log(`Linking Tx ${tx._id} to Loan ${loanIdToLink}`);
                
                tx.loan = loanIdToLink;
                if (!tx.metadata) tx.metadata = {};
                tx.metadata.loanId = loanIdToLink;
                
                await tx.save();
                fixedCount++;
            } else {
                console.log(`⚠️ Could not find loan for Tx: ${tx._id} (Desc: ${tx.description})`);
            }          
        }

        console.log(`\n✅ Fixed ${fixedCount} orphan transactions.`);
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

fixOrphans();
