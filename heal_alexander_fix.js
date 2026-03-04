const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
const amortizationEngine = require('./engines/amortizationEngine');
require('dotenv').config();

async function run() {
    console.log("Starting correction script...");
    await mongoose.connect(process.env.MONGO_URI);
    const clientObj = await Client.findOne({ name: { $regex: 'Alexander', $options: 'i' } });
    const loans = await Loan.find({ clientId: clientObj._id });
    const loan = loans.find(l => l._id.toString().endsWith('1d4cdf'));

    if (!loan) {
        console.error('Loan not found');
        process.exit(1);
    }

    const newSchedule = [];
    const basisQ = loan.schedule.find(q => parseFloat(q.amount) === 2000);
    const capitalFixed = basisQ.principalAmount || basisQ.capital;
    const interestFixed = basisQ.interestAmount || basisQ.interest;
    const baseAmount = parseFloat(capitalFixed) + parseFloat(interestFixed);

    let currentBalance = parseFloat(loan.amount);

    // Keep Q1 to Q5 (Paid)
    for (let i = 1; i <= 5; i++) {
        const q = loan.schedule.find(q => q.number === i);
        q.status = 'paid';
        newSchedule.push(q);
        currentBalance -= parseFloat(capitalFixed);
    }

    // Create Penalty Quota 6 (Paid)
    const penaltyDate = new Date('2026-02-16T12:00:00Z');
    newSchedule.push({
        number: 6,
        dueDate: penaltyDate,
        amount: mongoose.Types.Decimal128.fromString("1000.00"),
        principalAmount: mongoose.Types.Decimal128.fromString("0.00"),
        interestAmount: mongoose.Types.Decimal128.fromString("1000.00"),
        paidAmount: mongoose.Types.Decimal128.fromString("1000.00"),
        interestPaid: mongoose.Types.Decimal128.fromString("1000.00"),
        capitalPaid: mongoose.Types.Decimal128.fromString("0.00"),
        balance: mongoose.Types.Decimal128.fromString(currentBalance.toFixed(2)),
        status: 'paid',
        notes: " [Penalidad Aplicada]"
    });

    // Create remaining quotas 7 to 17 (11 quotas left of 2000, ALL PENDING)
    let lastDueDate = new Date('2026-02-28T12:00:00Z'); // Roughly 15 days from Feb 15
    for (let i = 7; i <= 17; i++) {
        lastDueDate = amortizationEngine.getNextDueDate(lastDueDate, loan.frequency);
        newSchedule.push({
            number: i,
            dueDate: lastDueDate,
            amount: mongoose.Types.Decimal128.fromString(baseAmount.toFixed(2)),
            principalAmount: capitalFixed,
            interestAmount: interestFixed,
            balance: mongoose.Types.Decimal128.fromString(Math.max(0, currentBalance - parseFloat(capitalFixed)).toFixed(2)),
            status: 'pending',
            daysOfGrace: 0,
            paidAmount: mongoose.Types.Decimal128.fromString("0.00"),
            interestPaid: mongoose.Types.Decimal128.fromString("0.00"),
            capitalPaid: mongoose.Types.Decimal128.fromString("0.00"),
            notes: ""
        });
        currentBalance -= parseFloat(capitalFixed);
    }

    loan.schedule = newSchedule;
    loan.duration = 17;

    let interestTotal = 0;
    let interestPaid = 0;
    loan.schedule.forEach(q => {
        interestTotal += parseFloat(q.interestAmount || q.interest);
        if (q.status === 'paid') {
            interestPaid += parseFloat(q.interestAmount || q.interest);
        }
    });

    if (!loan.financialModel) loan.financialModel = {};
    loan.financialModel.interestTotal = interestTotal;
    loan.financialModel.interestPaid = interestPaid;

    loan.markModified('schedule');
    loan.markModified('financialModel');
    await loan.save({ validateBeforeSave: false });

    console.log("Healed again! Q7 is now pending.");
    process.exit(0);
}
run();
