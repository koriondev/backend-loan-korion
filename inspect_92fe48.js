const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
const Transaction = require('./models/Transaction');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const inspectLoan = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });
        const allLoans = await Loan.find({ businessId: user.businessId }).populate('client');
        const loan = allLoans.find(l => l._id.toString().endsWith('92fe48'));

        if (!loan) {
            console.log('❌ Préstamo no encontrado');
            process.exit(1);
        }

        console.log('═══════════════════════════════════════');
        console.log(`PRÉSTAMO #${loan._id}`);
        console.log('═══════════════════════════════════════');
        console.log(`Cliente: ${loan.client ? loan.client.name : 'SIN CLIENTE'}`);
        console.log(`Monto: ${loan.amount}`);
        console.log(`Estado: ${loan.status}`);
        console.log(`Late Fee (Loan Level): ${loan.lateFee}`);

        console.log(`Tipo: ${loan.lendingType}`);
        console.log(`Frecuencia: ${loan.frequency}`);

        console.log('\n📅 SCHEDULE (All):');
        loan.schedule.slice(0, 5).forEach(q => {
            console.log(`  #${q.number} - Vence: ${new Date(q.dueDate).toLocaleDateString()} - Amount: ${q.amount} - Paid: ${q.paidAmount} - Status: ${q.status}`);
        });

        // Check Transactions by Client
        if (loan.client) {
            const transactions = await Transaction.find({
                businessId: user.businessId,
                client: loan.client._id,
                type: 'in_payment'
            }).sort({ date: -1 });

            console.log(`\n💰 Transactions for Client ${loan.client.name} (${transactions.length}):`);
            transactions.forEach(tx => {
                console.log(`  ID: ${tx._id}`);
                console.log(`  Date: ${new Date(tx.date).toLocaleDateString()}`);
                console.log(`  Amount: ${tx.amount}`);
                console.log(`  Breakdown:`, tx.metadata?.breakdown);
                console.log(`  Loan ID in Metadata: ${tx.metadata?.loanId}`);
                console.log('  ---');
            });
        }
        const transactions = await Transaction.find({
            businessId: user.businessId,
            $or: [
                { loan: loan._id },
                { 'metadata.loanId': loan._id.toString() }
            ],
            type: 'in_payment'
        });

        console.log(`\n💰 TRANSACCIONES (${transactions.length}):`);
        transactions.forEach(tx => {
            console.log(`  ID: ${tx._id}`);
            console.log(`  Fecha: ${new Date(tx.date).toLocaleString()}`);
            console.log(`  Monto: ${tx.amount}`);
            console.log(`  Breakdown:`, tx.metadata?.breakdown);
            console.log('-----------------------------------');
        });

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

inspectLoan();
