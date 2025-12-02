const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
const Transaction = require('./models/Transaction');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const checkLoan1d5ade = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });

        const allLoans = await Loan.find({ businessId: user.businessId }).populate('client');
        const loan = allLoans.find(l => l._id.toString().endsWith('1d5ade'));

        if (!loan) {
            console.error('❌ Préstamo no encontrado');
            process.exit(1);
        }

        console.log('═══════════════════════════════════════');
        console.log('PRÉSTAMO #1d5ade');
        console.log('═══════════════════════════════════════');
        console.log(`Cliente: ${loan.client.name}`);
        console.log(`Tipo: ${loan.lendingType}`);
        console.log(`Frecuencia: ${loan.frequency}`);
        console.log(`Creado: ${new Date(loan.createdAt).toLocaleString()}`);
        console.log(`Monto: ${loan.amount}`);
        console.log(`Balance: ${loan.balance}`);
        console.log(`\nPenalty Config:`);
        console.log(`  Tipo: ${loan.penaltyConfig?.type}`);
        console.log(`  Valor: ${loan.penaltyConfig?.value}`);
        console.log(`  Grace Period: ${loan.penaltyConfig?.gracePeriod || 0} días`);

        console.log('\n📅 Schedule (primeras 3 cuotas):');
        loan.schedule.slice(0, 3).forEach(q => {
            console.log(`\n  Cuota #${q.number}:`);
            console.log(`    Vencimiento: ${new Date(q.dueDate).toLocaleString()}`);
            console.log(`    Monto esperado: ${q.amount}`);
            console.log(`    Status: ${q.status}`);
            console.log(`    paidAmount: ${q.paidAmount || 0}`);
            console.log(`    paidInterest: ${q.paidInterest || 0}`);
            console.log(`    paidCapital: ${q.paidCapital || 0}`);
            if (q.paidDate) {
                console.log(`    Fecha de pago: ${new Date(q.paidDate).toLocaleString()}`);
            }
        });

        // Buscar transacciones
        const transactions = await Transaction.find({
            businessId: user.businessId,
            $or: [
                { loan: loan._id },
                { 'metadata.loanId': loan._id.toString() },
                { description: { $regex: '1d5ade' } }
            ],
            type: 'in_payment'
        }).sort({ date: 1 });

        console.log(`\n💰 Transacciones (${transactions.length}):`);
        transactions.forEach(tx => {
            console.log(`\n  ${new Date(tx.date).toLocaleString()}: ${tx.amount} pesos`);
            if (tx.metadata?.breakdown) {
                console.log(`    Mora: ${tx.metadata.breakdown.mora || 0}`);
                console.log(`    Interés: ${tx.metadata.breakdown.interest || 0}`);
                console.log(`    Capital: ${tx.metadata.breakdown.capital || 0}`);
            }
            console.log(`    Descripción: ${tx.description}`);
        });

        // Calcular si debería haber mora
        const now = new Date();
        const firstQuota = loan.schedule[0];
        const dueDate = new Date(firstQuota.dueDate);
        const gracePeriod = loan.penaltyConfig?.gracePeriod || 0;

        console.log(`\n🔍 ANÁLISIS:`);
        console.log(`  Primera cuota vence: ${dueDate.toLocaleString()}`);
        console.log(`  Grace period: ${gracePeriod} días`);

        // Calcular deadline con grace
        let graceDeadline = new Date(dueDate);
        graceDeadline.setDate(graceDeadline.getDate() + gracePeriod);

        console.log(`  Deadline con gracia: ${graceDeadline.toLocaleString()}`);

        if (transactions.length > 0) {
            const firstPayment = transactions[0];
            const paymentDate = new Date(firstPayment.date);
            console.log(`  Pagó el: ${paymentDate.toLocaleString()}`);
            console.log(`  Días después del vencimiento: ${Math.floor((paymentDate - dueDate) / (1000 * 60 * 60 * 24))}`);

            if (paymentDate <= graceDeadline) {
                console.log(`  ✅ Pagó DENTRO del grace period`);
                if ((firstPayment.metadata?.breakdown?.mora || 0) > 0) {
                    console.log(`  ⚠️  PERO se cobró mora de ${firstPayment.metadata.breakdown.mora} pesos - INCORRECTO`);
                }
            } else {
                console.log(`  ❌ Pagó DESPUÉS del grace period`);
                console.log(`  Mora cobrada: ${firstPayment.metadata?.breakdown?.mora || 0}`);
            }
        }

        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

checkLoan1d5ade();
