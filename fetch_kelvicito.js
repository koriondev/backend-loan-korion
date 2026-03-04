const mongoose = require('mongoose');
require('dotenv').config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Loan = require('./models/Loan');
        const Client = require('./models/Client');
        const Transaction = require('./models/Transaction');

        console.log('--- FINDING CLIENT ---');
        const client = await Client.findOne({ name: { $regex: 'Papa kelvicito', $options: 'i' } });
        if (!client) {
            console.log('Client not found');
            process.exit(0);
        }
        console.log('Found Client:', client._id, client.name);

        const loans = await Loan.find({ clientId: client._id });
        const loan = loans.find(l => l._id.toString().endsWith('31d5a1')) || loans[0];

        if (loan) {
            console.log('Found Loan:', loan._id);
            console.log('Schedule:', JSON.stringify(loan.schedule.map(q => ({
                n: q.number,
                dueDate: q.dueDate,
                amount: q.amount.toString(),
                paid: q.paidAmount?.toString() || '0',
                status: q.status,
                notes: q.notes
            })), null, 2));

            const txs = await Transaction.find({ $or: [{ loanV3: loan._id }, { loan: loan._id }, { 'metadata.loanId': loan._id.toString() }] }).sort({ date: 1 });
            console.log('\n--- TRANSACTIONS ---');
            txs.forEach(tx => console.log(`Date: ${tx.date.toISOString()}, ID: ${tx._id}, Amount: ${tx.amount}, Type: ${tx.category}, Desc: ${tx.description}, Metadata: ${JSON.stringify(tx.metadata)}`));
        } else {
            console.log('Loan not found');
        }
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}
run();
