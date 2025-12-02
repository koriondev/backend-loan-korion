const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const diagnoseTransactions = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });

        // 1. Verificar la transacción de Jose Ramon
        console.log('═══════════════════════════════════════');
        console.log('1. VERIFICANDO TRANSACCIÓN DE JOSE RAMON');
        console.log('═══════════════════════════════════════\n');

        const joseTransaction = await Transaction.findOne({
            businessId: user.businessId,
            amount: 500,
            type: 'in_payment',
            date: {
                $gte: new Date('2025-12-01T00:00:00Z'),
                $lte: new Date('2025-12-01T23:59:59Z')
            }
        });

        if (joseTransaction) {
            console.log(`ID: ${joseTransaction._id}`);
            console.log(`Fecha: ${new Date(joseTransaction.date).toLocaleString()}`);
            console.log(`Monto: ${joseTransaction.amount}`);
            console.log(`Descripción: ${joseTransaction.description}`);
            if (joseTransaction.metadata?.breakdown) {
                console.log(`Breakdown:`);
                console.log(`  - Mora: ${joseTransaction.metadata.breakdown.mora || 0}`);
                console.log(`  - Interés: ${joseTransaction.metadata.breakdown.interest || 0}`);
                console.log(`  - Capital: ${joseTransaction.metadata.breakdown.capital || 0}`);
            }
            console.log(`Loan ID: ${joseTransaction.loan}`);
        } else {
            console.log('❌ No encontrada');
        }

        // 2. Ver TODOS los préstamos y sus transacciones
        console.log('\n═══════════════════════════════════════');
        console.log('2. REVISANDO TODOS LOS PRÉSTAMOS');
        console.log('═══════════════════════════════════════\n');

        const loans = await Loan.find({ businessId: user.businessId }).populate('client').limit(5);

        for (const loan of loans) {
            console.log(`\n📋 Préstamo: ${loan.client.name} (${loan._id.toString().slice(-6)})`);
            console.log(`   Tipo: ${loan.lendingType}`);
            console.log(`   Balance: ${loan.balance}`);

            // Cuotas pagadas según schedule
            const paidQuotas = loan.schedule.filter(q => q.status === 'paid').length;
            console.log(`   Cuotas pagadas (schedule): ${paidQuotas}/${loan.schedule.length}`);

            // Transacciones registradas
            const txs = await Transaction.find({
                businessId: user.businessId,
                $or: [
                    { loan: loan._id },
                    { 'metadata.loanId': loan._id }
                ],
                type: 'in_payment'
            });

            console.log(`   Transacciones registradas: ${txs.length}`);

            if (txs.length > 0) {
                txs.forEach(tx => {
                    console.log(`     - ${new Date(tx.date).toLocaleDateString()}: ${tx.amount} pesos`);
                });
            } else {
                console.log(`     ⚠️  NO HAY TRANSACCIONES (pero schedule dice ${paidQuotas} pagadas)`);
            }
        }

        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

diagnoseTransactions();
