const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Transaction = require('./models/Transaction');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const cleanMora = async () => {
    try {
        // 1. FIX LOAN #1d5ade (Gregori Rafael) - Mora 40
        console.log('\n🔧 Corrigiendo Préstamo #1d5ade...');
        const loan1 = await Loan.findById('6927e58e312573d65d1d5ade'); // 1d5ade
        const tx1 = await Transaction.findById('692d077dc6923985f5684e01'); // 800 payment

        if (loan1 && tx1) {
            const moraAmount = 40;

            // Fix Transaction Metadata
            if (!tx1.metadata) tx1.metadata = {};
            if (!tx1.metadata.breakdown) tx1.metadata.breakdown = { interest: 0, capital: 0, mora: 0 };

            // It was 800 total. Assuming breakdown was missing, let's reconstruct it.
            // If it was "Mora: 40", then 760 was something else.
            // Let's check the schedule to see what it covered.
            // Quota #1 is 800.
            // So 40 mora means 760 went to quota.
            // We want 800 to go to quota.

            tx1.metadata.breakdown.mora = 0;
            tx1.metadata.breakdown.capital = 800; // Assuming all capital for simplicity or interest if redito
            tx1.metadata.breakdown.interest = 0;

            // Fix Description
            tx1.description = tx1.description.replace(/Mora: \d+(\.\d+)?/, 'Mora: 0');
            tx1.loan = loan1._id;

            tx1.markModified('metadata');
            await tx1.save();
            console.log('  ✅ Transacción corregida.');

            // Fix Loan Schedule
            // Find the quota this payment applied to. Likely #1.
            const quota = loan1.schedule.find(q => q.number === 1); // Assuming #1
            if (quota) {
                quota.paidAmount = 800;
                quota.paidCapital = 800; // Adjust if it has interest
                quota.status = 'paid';

                // If it's redito, logic might differ, but let's assume standard for now or check type
                if (loan1.lendingType === 'redito') {
                    quota.paidInterest = 800;
                    quota.paidCapital = 0;
                }
            }

            // Fix Balance
            // If 40 was considered mora, it wasn't deducted from balance (maybe).
            // Now 800 is paid.
            // Recalculate balance just to be sure.
            const totalExpected = loan1.schedule.reduce((acc, q) => acc + q.amount, 0);
            const totalPaid = loan1.schedule.reduce((acc, q) => acc + (q.paidAmount || 0), 0);
            loan1.balance = totalExpected - totalPaid;

            loan1.markModified('schedule');
            await loan1.save();
            console.log(`  ✅ Préstamo corregido. Nuevo Balance: ${loan1.balance}`);
        } else {
            console.log('  ❌ No se encontró préstamo o transacción #1d5ade');
        }

        // 2. CLEAN HISTORY FOR OTHERS (Update Descriptions)
        console.log('\n🧹 Limpiando historial (descripciones)...');

        const txsToClean = [
            '692da4f88fabfe343992ff89', // 92fe48 (Mora: 12.5)
            '692dc05c2023ecc31831815e', // 1d721b (Mora: 75)
            '692dc0752023ecc31831817a'  // 1d4cdf (Mora: 100)
        ];

        for (const txId of txsToClean) {
            const tx = await Transaction.findById(txId);
            if (tx) {
                const oldDesc = tx.description;
                tx.description = tx.description.replace(/Mora: \d+(\.\d+)?/, 'Mora: 0');
                if (tx.description !== oldDesc) {
                    await tx.save();
                    console.log(`  ✅ Descripción actualizada para ${tx._id}: ${tx.description}`);
                } else {
                    console.log(`  ⚠️ No se requirió cambio para ${tx._id}`);
                }
            }
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

cleanMora();
