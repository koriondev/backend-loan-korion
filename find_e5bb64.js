const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
    await mongoose.connect(process.env.MONGO_URI);
    const Transaction = require('./models/Transaction');

    // Search by description pattern
    const ts = await Transaction.find({ description: /e5bb64/ }).lean();
    console.log('Transactions found:', ts.length);
    ts.forEach(t => console.log('Desc:', t.description, '| loanV3:', t.loanV3));

    if (ts.length === 0) {
        // Try searching for recent transactions
        const recent = await Transaction.find({}).sort({ date: -1 }).limit(5).lean();
        console.log('Recent transactions:');
        recent.forEach(t => console.log('Desc:', t.description, '| loanV3:', t.loanV3));
    }

    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
