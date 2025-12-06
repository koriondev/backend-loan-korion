const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Transaction = require('./models/Transaction');
const Client = require('./models/Client');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const investigateDiscrepancy = async () => {
    try {
        const loanId = '692d2c339ee6c7e138429116';
        const loan = await Loan.findById(loanId).populate('client');

        if (!loan) {
            console.log('❌ Loan not found');
            process.exit(1);
        }

        console.log('═══════════════════════════════════════');
        console.log(`DEEP DIVE LOAN #${loan._id}`);
        console.log('═══════════════════════════════════════');

        // 1. Search for the 33,000 transaction
        console.log('\n--- SEARCHING FOR 33,000 TRANSACTION ---');
        // Search by amount 33000 in the whole DB
        const txs33k = await Transaction.find({ amount: 33000 });
        console.log(`Found ${txs33k.length} transactions with amount 33,000.`);

        txs33k.forEach(tx => {
            console.log(`  ID: ${tx._id}`);
            console.log(`  Date: ${new Date(tx.date).toLocaleString()}`);
            console.log(`  Loan Linked: ${tx.loan}`);
            console.log(`  Business ID: ${tx.businessId}`);
            console.log(`  Description: ${tx.description}`);
            console.log(`  Metadata:`, JSON.stringify(tx.metadata));
            console.log('  ---');
        });

        // 2. Analyze Late Fee (Mora)
        console.log('\n--- LATE FEE ANALYSIS ---');
        // Check if loan has a 'lateFee' field directly (some implementations do)
        // Or if it's calculated dynamically.
        // The user says "Mora Acumulada: 13,000".
        // Let's see if we can find where this 13,000 comes from.

        // Check if there is a 'lateFee' field in the document
        const loanObj = loan.toObject();
        console.log(`Loan.lateFee (direct field): ${loanObj.lateFee}`);
        console.log(`Loan.accumulatedMora: ${loanObj.accumulatedMora}`);

        // Check penalty config
        console.log(`Penalty Config:`, loan.penaltyConfig);

        // Check schedule for overdue items
        const today = new Date();
        let calculatedMora = 0;

        loan.schedule.forEach(q => {
            const dueDate = new Date(q.dueDate);
            if (q.status !== 'paid' && dueDate < today) {
                console.log(`  Quota #${q.number} is overdue (Due: ${dueDate.toLocaleDateString()})`);
                // If penalty is fixed
                if (loan.penaltyConfig.type === 'fixed') {
                    calculatedMora += loan.penaltyConfig.value;
                } else if (loan.penaltyConfig.type === 'percent') {
                    // Calculate percent of what? Capital? Amount?
                    // Usually capital or amount.
                    const base = q.amount; // Simplified assumption
                    calculatedMora += (base * loan.penaltyConfig.value / 100);
                }
            }
        });
        console.log(`Calculated Mora (Simple Estimate): ${calculatedMora}`);

        // 3. Reconcile Paid Amount
        console.log('\n--- PAID AMOUNT RECONCILIATION ---');
        // Frontend says "Total Pagado: 50,500".
        // Schedule sum says 50,500.
        // Transaction found (hopefully) is 33,000.
        // Missing: 50,500 - 33,000 = 17,500.

        // Maybe there are other transactions?
        // Let's list ALL transactions for this business, sorted by date desc, limit 20
        const recentTxs = await Transaction.find({ businessId: loan.businessId })
            .sort({ date: -1 })
            .limit(20);

        console.log(`\nRecent Transactions for Business ${loan.businessId}:`);
        recentTxs.forEach(tx => {
            console.log(`  ${new Date(tx.date).toLocaleDateString()} - ${tx.amount} - ${tx.description} - Loan: ${tx.loan}`);
        });

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

investigateDiscrepancy();
