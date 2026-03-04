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
    // Actually, looking at the transaction history from his screenshot:
    // 1/12/2025: 2000
    // 16/12/2025: 2000
    // 2/1/2026: 2000
    // 19/1/2026: 1000 (Penalty)
    // 3/2/2026: 2000
    // 16/2/2026: 2000
    // 1/3/2026: 2000
    // Total: 6 quotas of 2000 + 1 penalty of 1000.

    const quotaDates = [
        new Date('2025-11-30T12:00:00Z'),
        new Date('2025-12-15T12:00:00Z'),
        new Date('2025-12-31T12:00:00Z'),
        new Date('2026-01-15T12:00:00Z'),
        new Date('2026-01-31T12:00:00Z'),
        new Date('2026-02-15T12:00:00Z') // The 6th normal quota
    ];

    for (let i = 0; i < 6; i++) {
        newSchedule.push({
            number: i + 1,
            dueDate: quotaDates[i],
            amount: mongoose.Types.Decimal128.fromString(baseAmount.toFixed(2)),
            principalAmount: capitalFixed,
            interestAmount: interestFixed,
            balance: mongoose.Types.Decimal128.fromString(Math.max(0, currentBalance - parseFloat(capitalFixed)).toFixed(2)),
            status: 'paid',
            daysOfGrace: 0,
            paidAmount: mongoose.Types.Decimal128.fromString(baseAmount.toFixed(2)),
            interestPaid: interestFixed,
            capitalPaid: capitalFixed,
            notes: ""
        });
        currentBalance -= parseFloat(capitalFixed);
    }

    // Create Penalty Quota 7 (Paid)
    // The penalty happened on Jan 19, but conventionally placed after the sequence or chronologically. Let's put it at #7 to not confuse existing UI order.
    newSchedule.push({
        number: 7,
        dueDate: new Date('2026-02-16T12:00:00Z'),
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

    // Create remaining quotas 8 to 18 (10 quotas left of 2000, ALL PENDING)
    let lastDueDate = new Date('2026-02-28T12:00:00Z');
    for (let i = 8; i <= 17; i++) { // A 17 quotas fixed loan. 16 normal + 1 penalty = 17 physical slots. Wait, he says 17 cuotas. "7 / 17 Cuotas"
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
    loan.duration = 17; // Total slots

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

    console.log("Healed fully! 6 normal quotas marked paid, 1 penalty paid.");
    process.exit(0);
}
run();
