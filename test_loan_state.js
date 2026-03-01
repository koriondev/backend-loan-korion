const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

mongoose.connect(process.env.MONGO_URI, { dbName: 'test' }).then(async () => {
    const LoanV3 = require('./models/LoanV3.js');
    const PaymentV2 = require('./models/PaymentV2.js');

    // Buscar el préstamo de Arddeny por el shortId 1d4590
    const loans = await LoanV3.find({ businessId: '692635b070e60fc23382fe56' });
    const loan = loans.find(l => l._id.toString().includes('1d4590') || l._id.toString().slice(-6) === '1d4590');

    if (!loan) {
        console.log('Préstamo no encontrado. IDs disponibles:', loans.slice(0, 5).map(l => l._id.toString().slice(-6)));
        process.exit(1);
    }

    console.log('\n=== ESTADO DEL PRÉSTAMO ===');
    console.log('ID:', loan._id.toString());
    console.log('Cliente:', loan.clientId);
    console.log('Capital Original:', loan.amount?.$numberDecimal || loan.amount);
    console.log('Capital Actual:', loan.currentCapital?.$numberDecimal || loan.currentCapital);
    console.log('Status:', loan.status);
    console.log('\n--- CUOTAS ---');
    loan.schedule.forEach(q => {
        const paid = q.paidAmount?.$numberDecimal || q.paidAmount || 0;
        const amount = q.amount?.$numberDecimal || q.amount || 0;
        console.log(`Cuota ${q.number}: ${q.status} | Cuota=${amount} | Pagado=${paid} | Fecha=${new Date(q.dueDate).toLocaleDateString()}`);
    });

    const payments = await PaymentV2.find({ loanId: loan._id }).sort({ date: 1 });
    console.log(`\n--- HISTORIAL DE PAGOS (${payments.length} registros) ---`);
    payments.forEach(p => {
        console.log(`Fecha: ${new Date(p.date).toLocaleDateString()} | Total: ${p.amount} | Capital: ${p.appliedCapital} | Interés: ${p.appliedInterest} | Mora: ${p.appliedPenalty}`);
    });

    process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
