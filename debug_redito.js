const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
const User = require('./models/User');
const Transaction = require('./models/Transaction');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const debugReditoPayment = async () => {
    try {
        const user = await User.findOne({ email: 'duartecoronajeffrynoel@gmail.com' });

        // Buscar TODOS los préstamos rédito
        const loans = await Loan.find({
            businessId: user.businessId,
            lendingType: 'redito'
        }).populate('client');

        if (loans.length === 0) {
            console.error('❌ No se encontraron préstamos rédito');
            process.exit(1);
        }

        console.log(`✅ Encontrados ${loans.length} préstamos rédito:\n`);

        for (const loan of loans) {
            console.log(`══════════════════════════════════`);
            console.log(`Cliente: ${loan.client.name}`);
            console.log(`ID: ${loan._id}  `);
            console.log(`Creado: ${new Date(loan.createdAt).toLocaleDateString()}`);
            console.log(`Frecuencia: ${loan.frequency}`);
            console.log(`Balance: ${loan.balance}`);
            console.log(`Status: ${loan.status}`);

            const paidQuotas = loan.schedule.filter(q => q.status === 'paid');
            const totalQuotas = loan.schedule.length;
            console.log(`Cuotas: ${paidQuotas.length}/${totalQuotas}`);

            // Total pagado según schedule
            const totalPaidInSchedule = loan.schedule.reduce((acc, q) => acc + (q.paidAmount || 0), 0);
            console.log(`Total Pagado (según schedule): ${totalPaidInSchedule}`);

            // Buscar transacciones
            const transactions = await Transaction.find({
                businessId: user.businessId,
                loan: loan._id,
                type: 'in_payment'
            }).sort({ date: 1 });

            console.log(`\n💰 Transacciones de pago (${transactions.length}):`);
            let totalPaidInTx = 0;
            transactions.forEach(tx => {
                totalPaidInTx += tx.amount;
                console.log(`  ${new Date(tx.date).toLocaleString()}: ${tx.amount} pesos`);
                if (tx.metadata?.breakdown) {
                    console.log(`    → Mora: ${tx.metadata.breakdown.mora || 0}`);
                    console.log(`    → Interés: ${tx.metadata.breakdown.interest || 0}`);
                    console.log(`    → Capital: ${tx.metadata.breakdown.capital || 0}`);
                }
            });

            console.log(`Total Pagado (según transacciones): ${totalPaidInTx}`);

            if (totalPaidInSchedule !== totalPaidInTx) {
                console.log(`⚠️  DISCREPANCIA: ${totalPaidInSchedule} vs ${totalPaidInTx}`);
            }

            console.log(`\n📅 Schedule:`);
            loan.schedule.slice(0, 3).forEach(q => {
                console.log(`  Cuota #${q.number} (${new Date(q.dueDate).toLocaleDateString()}):`);
                console.log(`    Estado: ${q.status}`);
                console.log(`    Interés: ${q.interest}`);
                console.log(`    paidAmount: ${q.paidAmount || 0}`);
                console.log(`    paidInterest: ${q.paidInterest || 0}`);
            });
            console.log('');
        }

        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

debugReditoPayment();
