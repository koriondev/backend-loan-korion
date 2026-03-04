const mongoose = require('mongoose');
require('dotenv').config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Loan = require('./models/Loan');
        const PaymentV2 = require('./models/PaymentV2');
        const Transaction = require('./models/Transaction');

        const loanId = new mongoose.Types.ObjectId('69a8a4a76ba667fbd431d5a1');
        const loan = await Loan.findById(loanId);

        if (!loan) { console.log('Loan not found'); return; }

        const txs = await Transaction.find({ $or: [{ loanV3: loanId }, { loan: loanId }, { 'metadata.loanId': loanId.toString() }] });
        const payments = await PaymentV2.find({ loanId: loanId });

        console.log('--- RECONCILIATION ---');
        console.log('Loan Total Pagado in model:', loan.financialModel?.totalPaid || 'N/A');

        let sumSchedulePaid = 0;
        loan.schedule.forEach(q => {
            sumSchedulePaid += parseFloat(q.paidAmount?.toString() || '0');
        });
        console.log('Sum of paidAmount in Schedule:', sumSchedulePaid);

        let sumTransactions = 0;
        txs.forEach(tx => {
            if (tx.type === 'in_payment' || tx.category === 'Pago Préstamo' || tx.category === 'Otros Cargos') {
                sumTransactions += parseFloat(tx.amount?.toString() || '0');
            }
        });
        console.log('Sum of Transactions:', sumTransactions);

        let sumPaymentsV2 = 0;
        payments.forEach(p => {
            sumPaymentsV2 += parseFloat(p.amount?.toString() || '0');
        });
        console.log('Sum of PaymentV2:', sumPaymentsV2);

        console.log('\n--- PAYMENT V2 DETAILS ---');
        payments.sort((a, b) => a.date - b.date).forEach(p => {
            console.log(`Date: ${p.date.toISOString()}, Amount: ${p.amount}, ID: ${p._id}`);
        });

    } catch (err) { console.error(err); }
    finally { process.exit(0); }
}
run();
