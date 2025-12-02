const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
const Transaction = require('./models/Transaction');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const checkLoan = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });

        // Buscar préstamo #1d5f78
        const allLoans = await Loan.find({ businessId: user.businessId }).populate('client');
        const loan = allLoans.find(l => l._id.toString().endsWith('1d5f78'));

        if (!loan) {
            console.error('❌ Préstamo no encontrado');
            console.log('Préstamos disponibles:');
            allLoans.slice(0, 5).forEach(l => {
                console.log(`  - ${l._id.toString().slice(-6)}: ${l.client.name}`);
            });
            process.exit(1);
        }

        console.log('═══════════════════════════════════════');
        console.log('PRÉSTAMO ENCONTRADO');
        console.log('═══════════════════════════════════════');
        console.log(`Cliente: ${loan.client.name}`);
        console.log(`ID Completo: ${loan._id}`);
        console.log(`ID Corto: ${loan._id.toString().slice(-6)}`);
        console.log(`Tipo: ${loan.lendingType}`);
        console.log(`Balance: ${loan.balance}`);
        console.log(`Status: ${loan.status}`);

        // Cuotas pagadas según schedule
        const paidQuotas = loan.schedule.filter(q => q.status === 'paid');
        console.log(`\nCuotas pagadas (según schedule): ${paidQuotas.length}/${loan.schedule.length}`);

        if (paidQuotas.length > 0) {
            paidQuotas.forEach(q => {
                console.log(`  - Cuota #${q.number}: ${q.paidAmount} pesos (${q.paidDate ? new Date(q.paidDate).toLocaleDateString() : 'sin fecha'})`);
            });
        }

        // Buscar transacciones con TODAS las variantes posibles
        console.log('\n═══════════════════════════════════════');
        console.log('BUSCANDO TRANSACCIONES');
        console.log('═══════════════════════════════════════');

        const loanIdStr = loan._id.toString();
        const loanIdShort = loanIdStr.slice(-6);

        console.log(`Buscando con:`);
        console.log(`  - loan field: ${loanIdStr}`);
        console.log(`  - metadata.loanId: ${loanIdStr}`);
        console.log(`  - description contains: ${loanIdShort}`);

        const transactions = await Transaction.find({
            businessId: user.businessId,
            type: 'in_payment',
            $or: [
                { loan: loan._id },
                { 'metadata.loanId': loan._id.toString() },
                { 'metadata.loanId': loan._id },
                { description: { $regex: loanIdShort } }
            ]
        }).sort({ date: -1 });

        console.log(`\nTransacciones encontradas: ${transactions.length}`);

        if (transactions.length > 0) {
            transactions.forEach(tx => {
                console.log(`\n  📄 Transacción ${tx._id.toString().slice(-6)}`);
                console.log(`     Fecha: ${new Date(tx.date).toLocaleString()}`);
                console.log(`     Monto: ${tx.amount}`);
                console.log(`     loan field: ${tx.loan || 'NO DEFINIDO'}`);
                console.log(`     metadata.loanId: ${tx.metadata?.loanId || 'NO DEFINIDO'}`);
                console.log(`     Descripción: ${tx.description}`);
                if (tx.metadata?.breakdown) {
                    console.log(`     Breakdown: Mora=${tx.metadata.breakdown.mora}, Int=${tx.metadata.breakdown.interest}, Cap=${tx.metadata.breakdown.capital}`);
                }
            });
        } else {
            console.log('  ⚠️  NO HAY TRANSACCIONES REGISTRADAS para este préstamo');
            console.log('\n  Esto significa que:');
            console.log('  - Las cuotas fueron marcadas como pagadas manualmente');
            console.log('  - O se usó un script que no creó transacciones');
            console.log('  - El historial de pagos estará vacío en el frontend');
        }

        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

checkLoan();
