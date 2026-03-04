const mongoose = require('mongoose');
require('dotenv').config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Loan = require('./models/Loan');
        const Client = require('./models/Client');
        const Transaction = require('./models/Transaction');

        const client = await Client.findOne({ name: { $regex: 'Papa kelvicito', $options: 'i' } });
        if (!client) { process.exit(0); }

        const loans = await Loan.find({ clientId: client._id });
        const loan = loans.find(l => l._id.toString().endsWith('31d5a1')) || loans[0];

        if (loan) {
            console.log('Loan:', loan._id);
            console.log('Schedule Detail:');
            loan.schedule.forEach(q => {
                console.log(`Q${q.number}: ${q.status.padEnd(8)} | Due: ${q.dueDate.toISOString().split('T')[0]} | PaidDate: ${q.paidDate ? q.paidDate.toISOString() : 'N/A'} | Amount: ${q.amount} | PaidAmt: ${q.paidAmount} | Notes: ${q.notes || ''}`);
            });

            console.log('\n--- TRANSACTIONS ---');
            const txs = await Transaction.find({ $or: [{ loanV3: loan._id }, { loan: loan._id }, { 'metadata.loanId': loan._id.toString() }] }).sort({ date: 1 });
            txs.forEach(tx => console.log(`Date: ${tx.date.toISOString()}, Amount: ${tx.amount}, Type: ${tx.category}, Desc: ${tx.description}`));
        }
    } catch (err) { console.error(err); }
    finally { process.exit(0); }
}
run();
