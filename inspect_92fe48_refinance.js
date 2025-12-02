const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
const Transaction = require('./models/Transaction');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const inspectLoan = async () => {
    try {
        const loanId = '692da4c48fabfe343992fe48'; // 92fe48
        const loan = await Loan.findById(loanId).populate('client');

        if (!loan) {
            console.log('❌ Préstamo no encontrado');
            process.exit(1);
        }

        console.log('═══════════════════════════════════════');
        console.log(`PRÉSTAMO #${loan._id}`);
        console.log('═══════════════════════════════════════');
        console.log(`Cliente: ${loan.client ? loan.client.name : 'SIN CLIENTE'}`);
        console.log(`Monto Original: ${loan.amount}`);
        console.log(`Balance Actual: ${loan.balance}`);
        console.log(`Tipo: ${loan.lendingType}`);
        console.log(`Frecuencia: ${loan.frequency}`);

        console.log('\n📅 SCHEDULE (First 5):');
        loan.schedule.slice(0, 5).forEach(q => {
            console.log(`  #${q.number} - Vence: ${new Date(q.dueDate).toLocaleDateString()} - Amount: ${q.amount} - Paid: ${q.paidAmount} - Status: ${q.status}`);
        });

        const transactions = await Transaction.find({
            loan: loan._id,
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
