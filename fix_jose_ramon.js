const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
const User = require('./models/User');
const Transaction = require('./models/Transaction');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const fixJoseRamonLoan = async () => {
    try {
        // Buscar user por email
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });
        if (!user) {
            console.error('❌ Usuario no encontrado');
            process.exit(1);
        }

        console.log(`✅ Usuario: ${user.name}\n`);

        // Buscar TODOS los préstamos rédito del usuario para encontrar el de Jose Ramon
        const allLoans = await Loan.find({
            businessId: user.businessId,
            lendingType: 'redito'
        }).populate('client');

        console.log(`Encontrados ${allLoans.length} préstamos rédito\n`);

        const loan = allLoans.find(l => l._id.toString().endsWith('1d61c7'));

        if (!loan) {
            console.error('❌ No se encontró préstamo con ID que termine en 1d61c7');
            console.log('IDs disponibles:');
            allLoans.forEach(l => console.log(`  - ${l._id.toString().slice(-6)}: ${l.client.name}`));
            process.exit(1);
        }
        console.log(`✅ Préstamo encontrado:`);
        console.log(`   Cliente: ${loan.client.name}`);
        console.log(`   ID: ${loan._id}`);
        console.log(`   Tipo: ${loan.lendingType}`);
        console.log(`   Creado: ${new Date(loan.createdAt).toLocaleString()}`);
        console.log(`   Status: ${loan.status}`);
        console.log(`   Balance: ${loan.balance}`);
        console.log(`   Grace Period: ${loan.penaltyConfig?.gracePeriod || 0}`);
        console.log(`\n📅 Schedule (primeras 3 cuotas):`);

        loan.schedule.slice(0, 3).forEach(q => {
            console.log(`   Cuota #${q.number}:`);
            console.log(`      Vencimiento: ${new Date(q.dueDate).toLocaleString()}`);
            console.log(`      Interés: ${q.interest}`);
            console.log(`      Status: ${q.status}`);
            console.log(`      paidAmount: ${q.paidAmount || 0}`);
            console.log(`      paidInterest: ${q.paidInterest || 0}`);
            console.log(`      paidCapital: ${q.paidCapital || 0}`);
            console.log('');
        });

        // Buscar transacciones
        const transactions = await Transaction.find({
            businessId: user.businessId,
            loan: loan._id,
            type: 'in_payment'
        }).sort({ date: 1 });

        console.log(`\n💰 Transacciones (${transactions.length}):`);
        transactions.forEach(tx => {
            console.log(`   ID: ${tx._id}`);
            console.log(`   Fecha: ${new Date(tx.date).toLocaleString()}`);
            console.log(`   Monto: ${tx.amount}`);
            if (tx.metadata?.breakdown) {
                console.log(`   → Mora: ${tx.metadata.breakdown.mora || 0}`);
                console.log(`   → Interés: ${tx.metadata.breakdown.interest || 0}`);
                console.log(`   → Capital: ${tx.metadata.breakdown.capital || 0}`);
            }
            console.log('');
        });

        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

fixJoseRamonLoan();
