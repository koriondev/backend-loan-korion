const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Client = require('./models/Client'); // add this
const amortizationEngine = require('./engines/amortizationEngine');
require('dotenv').config();

async function run() {
    console.log("Starting script...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to DB...");
    const clientObj = await Client.findOne({ name: { $regex: 'Alexander', $options: 'i' } });
    const loans = await Loan.find({ clientId: clientObj._id });
    const loan = loans.find(l => l._id.toString().endsWith('1d4cdf'));

    if (!loan) {
        console.error('Loan not found');
        process.exit(1);
    }

    console.log("Current Schedule length:", loan.schedule.length);
    console.log("Schedule:", loan.schedule.map(q => ({ n: q.number, st: q.status, amt: q.amount.toString(), pr: q.principalAmount?.toString(), date: q.dueDate })));

    // For Alexander:
    // Cuota 1 to 5: 2000 Pagado
    // Cuota 6: 1000 Pagado (Penalty) -> Should be "Pagado" but with principle = 0, interest = 1000. Wait, in the screenshot: "6 15/2/2026 RD$1,000 Pagado"
    // Cuota 7: 2000 Pagado -> Wait, in the screenshot, Cuota 7 is "Pagado"? No, the screenshot says "7 14/3/2026 RD$2,000 Pagado", then "8 30/3/2026 RD$2,000 Pendiente"
    // Keep Q1 to Q5
    // Actually the user literally says: "Cuota 6 15/2/2026 RD$1000 Pagado". Cuota 7 is RD$2000 Pagado.

    // Repairing...
    const newSchedule = [];
    const basisQ = loan.schedule.find(q => parseFloat(q.amount) === 2000);
    const capitalFixed = basisQ.principalAmount || basisQ.capital;
    const interestFixed = basisQ.interestAmount || basisQ.interest;
    const baseAmount = parseFloat(capitalFixed) + parseFloat(interestFixed);
    console.log("Basis Capital:", parseFloat(capitalFixed), "Interest:", parseFloat(interestFixed));

    let currentBalance = parseFloat(loan.amount);

    // Keep Q1 to Q5
    for (let i = 1; i <= 5; i++) {
        newSchedule.push(loan.schedule.find(q => q.number === i));
        currentBalance -= parseFloat(capitalFixed);
    }

    // Create Penalty Quota 6
    const penaltyDate = loan.schedule.find(q => q.number === 6)?.dueDate || new Date('2026-02-15');
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

    // We must keep Cuota 7 as Pagado because Alexander paid his Cuota 7 already.
    const q7 = loan.schedule.find(q => parseFloat(q.amount) === 2000 && q.number > 5);
    q7.number = 7;
    q7.status = 'paid';
    q7.paidAmount = mongoose.Types.Decimal128.fromString("2000.00");
    newSchedule.push(q7);
    currentBalance -= parseFloat(capitalFixed);

    // Create remaining quotas 8 to 17 (10 quotas left of 2000)
    let lastDueDate = q7.dueDate;
    for (let i = 8; i <= 17; i++) {
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
            capitalPaid: mongoose.Types.Decimal128.fromString("0.00")
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

    console.log("Healed!");
    process.exit(0);
}
run();
