const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Transaction = require('./models/Transaction');
const Client = require('./models/Client');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const inspectLoan = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });
        const allLoans = await Loan.find({ businessId: user.businessId }).populate('client');
        const loan = allLoans.find(l => l._id.toString().endsWith('1d4590'));

        if (!loan) {
            console.log('❌ Préstamo no encontrado');
            process.exit(1);
        }

        console.log('═══════════════════════════════════════');
        console.log(`PRÉSTAMO #${loan._id}`);
        console.log('═══════════════════════════════════════');
        console.log(`Cliente: ${loan.client ? loan.client.name : 'SIN CLIENTE'} (${loan.client ? loan.client._id : loan.client})`);
        console.log(`Monto: ${loan.amount}`);
        console.log(`Duración: ${loan.duration}`);
        console.log(`Frecuencia: ${loan.frequency}`);
        console.log(`Tipo: ${loan.lendingType}`);
        console.log(`Estado: ${loan.status}`);
        console.log(`Late Fee: ${loan.lateFee}`);

        console.log('\n📅 SCHEDULE (Primeras 3 cuotas):');
        loan.schedule.slice(0, 3).forEach(q => {
            console.log(`  #${q.number} - Vence: ${new Date(q.dueDate).toLocaleDateString()} - Monto: ${q.amount} - Estado: ${q.status}`);
            console.log(`       Pagado: ${q.paidAmount} (Int: ${q.paidInterest}, Cap: ${q.paidCapital})`);
        });

        const transactions = await Transaction.find({
            businessId: user.businessId,
            $or: [
                { loan: loan._id },
                { 'metadata.loanId': loan._id.toString() },
                { description: { $regex: '1d4590' } }
            ]
        });

        console.log(`\n💰 TRANSACCIONES (${transactions.length}):`);
        transactions.forEach(tx => {
            console.log(`  ID: ${tx._id}`);
            console.log(`  Fecha: ${new Date(tx.date).toLocaleString()}`);
            console.log(`  Monto: ${tx.amount}`);
            console.log(`  Tipo: ${tx.type}`);
            console.log(`  Loan Field: ${tx.loan}`);
            console.log(`  Metadata:`, tx.metadata);
            console.log('-----------------------------------');
        });

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

inspectLoan();
