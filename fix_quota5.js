const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

mongoose.connect(process.env.MONGO_URI, { dbName: 'test' }).then(async () => {
    const LoanV3 = require('./models/LoanV3.js');

    const loan = await LoanV3.findById('6927e04d312573d65d1d4590');
    if (!loan) { console.log('Préstamo no encontrado'); process.exit(1); }

    // La cuota 5 tiene paidAmount=1200 y debería estar completamente pagada
    // Cada pago de RD$2000 = RD$750 interés + RD$1250 capital — la cuota cuesta RD$2000
    // El 5to pago de RD$2000 aplicó capital+interés correctamente
    // Pero paidAmount=1200, indicando que solo se registró RD$1200 no RD$2000
    // Necesitamos completar cuota 5 con los RD$800 restantes que corresponden al pago del 2/3/2026

    const q5 = loan.schedule.find(q => q.number === 5);
    console.log('Estado actual cuota 5:', JSON.stringify(q5, null, 2));

    // CORREGIR: Marcar cuota 5 como completamente pagada
    q5.paidAmount = mongoose.Types.Decimal128.fromString('2000.00');
    q5.status = 'paid';

    // El currentCapital debe reflejar 5 cuotas de capital pagado (5 x 1250 = 6250 devuelto)
    // Capital original = 20000, capital restante debe ser = 20000 - 6250 = 13750 (ya es correcto)

    loan.markModified('schedule');
    await loan.save();

    console.log('\n✅ Cuota 5 corregida a pagado.');
    const updated = await LoanV3.findById('6927e04d312573d65d1d4590');
    updated.schedule.slice(0, 7).forEach(q => {
        const paid = q.paidAmount?.$numberDecimal || q.paidAmount || 0;
        console.log(`Cuota ${q.number}: ${q.status} | Pagado=${paid}`);
    });

    process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
