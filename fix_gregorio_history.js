require('dotenv').config();
const mongoose = require('mongoose');
const PaymentV2 = require('./models/PaymentV2');
const Transaction = require('./models/Transaction');
const Loan = require('./models/Loan');

const getD = (val) => {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'object' && val.$numberDecimal) return parseFloat(val.$numberDecimal);
    if (typeof val === 'object' && val.constructor.name === 'Decimal128') return parseFloat(val.toString());
    return parseFloat(val) || 0;
};

async function fix() {
    await mongoose.connect(process.env.MONGO_URI, { dbName: 'test' });
    const db = mongoose.connection.db;

    const paymentId = new mongoose.Types.ObjectId('69a8bfc77240841091de0e85');
    const payment = await db.collection('paymentv2').findOne({ _id: paymentId });

    if (payment) {
        console.log("Updating PaymentV2...");
        await db.collection('paymentv2').updateOne({ _id: paymentId }, {
            $set: {
                appliedPenalty: 0,
                appliedCapital: 1666.6666666666665,
                'metadata.breakdown.appliedCapital': 1666.6666666666665,
                'metadata.breakdown.appliedPenalty': 0,
                'metadata.breakdown.mora': 0
            }
        });

        console.log("Updating Transaction...");
        await db.collection('transactions').updateOne({ receiptId: payment.receiptId }, {
            $set: {
                description: "Pago Préstamo | Interés: 533.33 | Capital: 1666.67",
                'metadata.breakdown.appliedCapital': 1666.6666666666665,
                'metadata.breakdown.appliedToCapital': 1666.6666666666665,
                'metadata.breakdown.capital': 1666.6666666666665,
                'metadata.breakdown.appliedPenalty': 0,
                'metadata.breakdown.appliedToMora': 0,
                'metadata.breakdown.mora': 0
            }
        });
    }

    // Now re-run a mini-sync for the loan to ensure totals are correct
    console.log("Re-syncing Loan totals...");
    const loanId = new mongoose.Types.ObjectId('69307dbb85ad04f8c6e5ac32');
    const loan = await Loan.findById(loanId);

    // We'll recalculate totals based on all transactions
    const txs = await Transaction.find({
        client: loan.clientId,
        $or: [
            { loanV3: loan._id },
            { description: { $regex: loan._id.toString().slice(-6) } }
        ],
        category: { $in: ['Pago Préstamo', 'Otros Cargos'] },
        isArchived: { $ne: true }
    });

    let totalPaid = 0;
    txs.forEach(t => {
        totalPaid += getD(t.amount);
    });
    console.log(`Verified Total Paid for Loan: ${totalPaid}`);

    // Update loan meta if needed
    // Actually, "Total Pagado" in UI is often calculated on the fly or from financialModel.interestPaid + capitalPaid
    // Let's see if we have a field for it.

    await mongoose.disconnect();
    console.log("Done.");
}

fix().catch(console.error);
