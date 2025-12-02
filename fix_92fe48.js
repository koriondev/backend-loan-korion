const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Transaction = require('./models/Transaction');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const fixLoan = async () => {
    try {
        const loanId = '692da4c48fabfe343992fe48';
        const txId = '692da4f88fabfe343992ff89';

        console.log(`Procesando Préstamo ${loanId}...`);

        // 1. Update Transaction
        const tx = await Transaction.findById(txId);
        if (!tx) {
            console.error('❌ Transacción no encontrada');
            process.exit(1);
        }

        console.log(`Breakdown Original:`, tx.metadata.breakdown);

        // Remove mora (12.5) and add to capital
        const mora = tx.metadata.breakdown.mora || 0;
        tx.metadata.breakdown.mora = 0;
        tx.metadata.breakdown.capital = (tx.metadata.breakdown.capital || 0) + mora;

        // Link to loan
        tx.loan = loanId;

        tx.markModified('metadata');
        await tx.save();
        console.log(`✅ Breakdown Actualizado:`, tx.metadata.breakdown);

        // 2. Update Loan Balance
        const loan = await Loan.findById(loanId);
        if (!loan) {
            console.error('❌ Préstamo no encontrado');
            process.exit(1);
        }

        // Calculate correct balance for Redito Loan
        // Balance = Initial Amount - Total Capital Paid
        // We know this transaction paid 500 capital.
        // Are there other capital payments? The inspection showed 0 other transactions.
        // So Total Capital Paid = 500.
        // Initial Amount = 5000.
        // Expected Balance = 4500.

        const initialAmount = loan.amount;
        const capitalPaid = 500; // From our corrected transaction
        const newBalance = initialAmount - capitalPaid;

        console.log(`Balance Actual: ${loan.balance}`);
        console.log(`Nuevo Balance Calculado: ${newBalance}`);

        loan.balance = newBalance;

        // Also ensure schedule reflects paid status (already seems correct: 2 quotas paid)
        // But we should verify paidCapital in quotas is 0 (since it's redito, quotas are interest only)
        // The inspection showed "Paid: 250 (Int: 0, Cap: 0)". This is weird.
        // If status is paid, paidAmount should be 250.
        // Let's fix the paid amounts in schedule just in case.

        loan.schedule.forEach(q => {
            if (q.status === 'paid' && q.paidAmount === 0) {
                q.paidAmount = q.amount;
                q.paidInterest = q.amount; // In redito, amount is interest
            }
        });

        await loan.save();
        console.log('✅ Préstamo actualizado.');

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

fixLoan();
