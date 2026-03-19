require('dotenv').config();
const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const PaymentV2 = require('./models/PaymentV2');
const Settings = require('./models/Settings');
const { distributePayment, applyPaymentToLoan } = require('./engines/paymentEngine');
const { calculatePenaltyV2 } = require('./engines/penaltyEngine'); // Use legacy for V1 if available, else V3

const getVal = (v) => {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'object' && v.$numberDecimal) return parseFloat(v.$numberDecimal);
    if (typeof v === 'object' && v.constructor.name === 'Decimal128') return parseFloat(v.toString());
    return parseFloat(v) || 0;
};

async function heal() {
    await mongoose.connect(process.env.MONGO_URI);
    const loanId = '6927ed1a312573d65d1d8a59';
    const loan = await Loan.findById(loanId);

    if (!loan) {
        console.error("Loan not found");
        process.exit(1);
    }

    console.log(`Healing loan ${loanId} (${loan.status})...`);

    // 1. Fetch payments
    const payments = await PaymentV2.find({ loanId: loan._id }).sort({ date: 1 });
    console.log(`Found ${payments.length} payments.`);

    // 2. Reset Loan State
    loan.currentCapital = loan.amount;
    if (loan.financialModel) {
        loan.financialModel.interestPaid = 0;
        loan.financialModel.interestPending = loan.financialModel.interestTotal;
    }
    if (loan.penaltyConfig) {
        loan.penaltyConfig.paidPenalty = 0;
    }

    loan.schedule.forEach(inst => {
        inst.interestPaid = mongoose.Types.Decimal128.fromString('0');
        inst.capitalPaid = mongoose.Types.Decimal128.fromString('0');
        inst.paidAmount = mongoose.Types.Decimal128.fromString('0');
        inst.status = 'pending';
        inst.paidDate = null;
    });

    // 3. Re-apply payments
    const settings = await Settings.findOne({ businessId: loan.businessId });

    for (const payment of payments) {
        console.log(`Re-applying payment of ${payment.amount} from ${payment.date}...`);

        // Use engine to distribute
        // Note: For V1 loans, currentPenalty might be needed. 
        // We'll use a simplified penalty check or mock since we're re-applying historicals
        const penaltyData = { totalPenalty: 0 }; // Simplified for now to focus on installments

        const distribution = distributePayment(loan, payment.amount, penaltyData);
        applyPaymentToLoan(loan, distribution, payment.date);

        // Update payment record metadata to match new distribution if needed
        payment.metadata = {
            breakdown: {
                appliedCapital: distribution.appliedCapital,
                appliedInterest: distribution.appliedInterest,
                appliedPenalty: distribution.appliedPenalty
            }
        };
        await payment.save();
    }

    loan.markModified('schedule');
    loan.markModified('financialModel');
    loan.markModified('penaltyConfig');

    await loan.save({ validateBeforeSave: false });

    console.log(`Loan healed. New status: ${loan.status}, Capital: ${loan.currentCapital}`);

    await mongoose.disconnect();
}

heal().catch(console.error);
