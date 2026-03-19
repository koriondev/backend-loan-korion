require('dotenv').config();
const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const PaymentV2 = require('./models/PaymentV2');
const Transaction = require('./models/Transaction');
const Settings = require('./models/Settings');
const { distributePayment, applyPaymentToLoan } = require('./engines/paymentEngine');

const getVal = (v) => {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'object' && v.$numberDecimal) return parseFloat(v.$numberDecimal);
    if (typeof v === 'object' && v.constructor.name === 'Decimal128') return parseFloat(v.toString());
    return parseFloat(v) || 0;
};

async function fixAndHeal() {
    await mongoose.connect(process.env.MONGO_URI);

    // THE LOAN WE WANT TO FIX
    const targetLoanId = new mongoose.Types.ObjectId('6927ed1a312573d65d1d8a59');
    const loan = await Loan.findById(targetLoanId);

    if (!loan) {
        console.error("Loan not found");
        process.exit(1);
    }

    console.log(`Fixing and Healing loan ${loan._id} (#${loan._id.toString().slice(-6)})...`);

    // 1. Find all transactions related to THIS loan or its client that have receipts we know are for this loan
    const txs = await Transaction.find({
        businessId: loan.businessId,
        $or: [
            { loan: targetLoanId },
            { loanV3: targetLoanId },
            { description: { $regex: loan._id.toString().slice(-6), $options: 'i' } }
        ],
        isArchived: { $ne: true }
    }).sort({ date: 1 });

    console.log(`Found ${txs.length} relevant transactions.`);
    const receiptIds = txs.map(t => t.receiptId).filter(id => id);

    // 2. Find and UPDATE mis-linked PaymentV2 records
    const payments = await PaymentV2.find({ receiptId: { $in: receiptIds } }).sort({ date: 1 });
    console.log(`Found ${payments.length} matching PaymentV2 records.`);

    for (const payment of payments) {
        if (!payment.loanId.equals(targetLoanId)) {
            console.log(`Updating PaymentV2 ${payment._id} loanId from ${payment.loanId} to ${targetLoanId}`);
            payment.loanId = targetLoanId;
            payment.businessId = loan.businessId; // Ensure business matches too
            await payment.save();
        }
    }

    // 3. Reset Loan State before re-sync
    console.log("Resetting loan state for re-sync...");
    loan.currentCapital = loan.amount;
    if (loan.financialModel) {
        loan.financialModel.interestPaid = 0;
        loan.financialModel.interestPending = loan.financialModel.interestTotal;
    }
    if (loan.penaltyConfig) {
        loan.penaltyConfig.paidPenalty = 0;
    }

    // IMPORTANT: Reset status to active or past_due depending on date
    loan.status = 'active';

    loan.schedule.forEach(inst => {
        inst.interestPaid = 0;
        inst.capitalPaid = 0;
        inst.paidAmount = 0;
        inst.status = 'pending';
        inst.paidDate = null;
    });

    // 4. Re-apply all payments using Transactions as source of truth
    const settings = await Settings.findOne({ businessId: loan.businessId });

    for (const tx of txs) {
        if (tx.type !== 'in_payment') continue;
        console.log(`Re-applying transaction payment: ${tx.amount} (Date: ${tx.date})`);

        // Distribution logic
        const penaltyData = { totalPenalty: 0 }; // Simplified
        const distribution = distributePayment(loan, tx.amount, penaltyData);
        applyPaymentToLoan(loan, distribution, tx.date);

        // Ensure a PaymentV2 exists for this transaction if missing
        if (tx.receiptId) {
            let payment = await PaymentV2.findOne({ receiptId: tx.receiptId });
            if (payment) {
                payment.loanId = targetLoanId;
                payment.metadata = {
                    ...payment.metadata,
                    breakdown: {
                        appliedCapital: distribution.appliedCapital,
                        appliedInterest: distribution.appliedInterest,
                        appliedPenalty: distribution.appliedPenalty
                    }
                };
                await payment.save();
            }
        }
    }

    loan.markModified('schedule');
    loan.markModified('financialModel');
    loan.markModified('penaltyConfig');

    await loan.save({ validateBeforeSave: false });

    console.log(`Loan ${loan._id} fixed. Final Capital: ${loan.currentCapital}, Status: ${loan.status}`);

    await mongoose.disconnect();
}

fixAndHeal().catch(console.error);
