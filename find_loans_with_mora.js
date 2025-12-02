const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
const Transaction = require('./models/Transaction');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const findMora = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });
        const allLoans = await Loan.find({ businessId: user.businessId }).populate('client');
        const allTransactions = await Transaction.find({
            businessId: user.businessId,
            type: 'in_payment',
            $or: [
                { 'metadata.breakdown.mora': { $gt: 0 } },
                { description: { $regex: 'Mora', $options: 'i' } }
            ]
        });

        console.log('═══════════════════════════════════════');
        console.log('🔍 REPORTE DE MORAS ENCONTRADAS');
        console.log('═══════════════════════════════════════');

        let loansWithMora = new Set();

        // 1. Check Loans with lateFee > 0
        const loansWithLateFee = allLoans.filter(l => l.lateFee > 0);
        if (loansWithLateFee.length > 0) {
            console.log('\n📌 PRÉSTAMOS CON MORA PENDIENTE (lateFee > 0):');
            loansWithLateFee.forEach(l => {
                console.log(`  - ${l._id} (${l.client?.name}): $${l.lateFee}`);
                loansWithMora.add(l._id.toString());
            });
        } else {
            console.log('\n✅ No hay préstamos con mora pendiente acumulada.');
        }

        // 2. Check Transactions with Mora Paid or Description match
        if (allTransactions.length > 0) {
            console.log('\n💸 TRANSACCIONES SUSPECHOSAS (Mora > 0 o "Mora" en descripción):');
            for (const tx of allTransactions) {
                let loanId = tx.loan || tx.metadata?.loanId;
                let clientName = 'Desconocido';

                if (loanId) {
                    const loan = allLoans.find(l => l._id.toString() === loanId.toString());
                    if (loan) clientName = loan.client?.name;
                    loansWithMora.add(loanId.toString());
                }

                const moraAmount = tx.metadata?.breakdown?.mora;

                // Filter out the ones we know are 0 and fixed (unless description says otherwise)
                if (moraAmount === 0 && !tx.description.includes('Mora')) continue;

                console.log(`  - Cliente: ${clientName}`);
                console.log(`    TxID: ${tx._id}`);
                console.log(`    Fecha: ${new Date(tx.date).toLocaleDateString()}`);
                console.log(`    Monto Total: $${tx.amount}`);
                console.log(`    Mora (Metadata): ${moraAmount}`);
                console.log(`    Descripción: "${tx.description}"`);
                console.log('    ---');
            }
        }

        console.log('\n═══════════════════════════════════════');
        console.log(`TOTAL PRÉSTAMOS AFECTADOS: ${loansWithMora.size}`);
        console.log('═══════════════════════════════════════');

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

findMora();
