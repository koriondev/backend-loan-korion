const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Transaction = require('./models/Transaction');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const fixRefinance = async () => {
    try {
        const loanId = '692da4c48fabfe343992fe48'; // 92fe48
        const txId = '692da4f88fabfe343992ff89'; // The 1000 payment ID we know from before

        console.log(`Procesando Préstamo ${loanId}...`);

        // 1. Fix Transaction
        const tx = await Transaction.findById(txId);
        if (!tx) {
            console.error('❌ Transacción original no encontrada');
            process.exit(1);
        }

        console.log(`Breakdown Original:`, tx.metadata?.breakdown);

        // Set new breakdown: 250 Interest, 750 Capital
        tx.metadata = tx.metadata || {};
        tx.metadata.breakdown = {
            interest: 250,
            capital: 750,
            mora: 0
        };
        tx.loan = loanId; // Ensure linked
        tx.description = `Pago Préstamo #${loanId.slice(-6)} (Refinanciamiento)`;

        await tx.save();
        console.log(`✅ Transacción actualizada:`, tx.metadata.breakdown);

        // 2. Fix Loan
        const loan = await Loan.findById(loanId);

        // Update Balance
        // Target Balance: 9250
        loan.balance = 9250;

        // Update Schedule
        // Quota #1 (Interest) should be paid.
        // In Redito, quotas are interest only.
        // Amount is 10000 * 5% = 500.
        // But user says "quota he had paid was 250". That was based on 5000.
        // Now the schedule is based on 10000 (500 per quota).
        // This is tricky. The schedule regenerated with 500.
        // But the payment covered the *previous* period's interest (250).
        // So Quota #1 in this new schedule represents the *next* payment?
        // Or did the edit reset the start date?
        // If start date is same, Quota #1 is due 12/1.
        // He paid 250 interest on 12/1.
        // But the new schedule says Quota #1 is 500.
        // We should probably mark Quota #1 as PARTIALLY paid? Or just paid 250?
        // User said: "the linked payment is going to be divided 250 interest and 750 capital".
        // So we should record that.

        const quota1 = loan.schedule[0];
        if (quota1) {
            quota1.paidAmount = 250; // Interest part
            quota1.paidInterest = 250;
            quota1.paidCapital = 0; // Capital payment doesn't go to quota in Redito usually, it reduces principal
            quota1.status = 'partial'; // 250 paid of 500 due?
            // Wait, if he paid 250, that was the FULL interest for the 5000 loan.
            // Now the loan is 10000.
            // The interest for the *next* period will be 500.
            // But for *this* period (12/1), it was 250.
            // So Quota #1 should be considered PAID with 250?
            // If we leave it as partial (250/500), he will owe 250 more for this period.
            // But he doesn't owe more for *this* period because the 10000 started *after* this payment?
            // "Then he took 5000 more".
            // So the 10000 principal starts NOW.
            // The interest of 500 starts NEXT period.
            // So Quota #1 (12/1) should be 250.
            // But the schedule generator made it 500 because it sees 10000 principal.

            // Hack: Force Quota #1 amount to 250 and mark as paid.
            quota1.amount = 250;
            quota1.paidAmount = 250;
            quota1.paidInterest = 250;
            quota1.status = 'paid';
        }

        // Also, we need to ensure the capital payment (750) is reflected in the loan's "currentCapital" or similar if tracked?
        // In Redito, balance is usually principal.
        // 10000 - 750 = 9250.
        // So balance = 9250 is correct.

        loan.markModified('schedule');
        await loan.save();
        console.log(`✅ Préstamo actualizado. Balance: ${loan.balance}`);

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

fixRefinance();
