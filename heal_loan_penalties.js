const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const PaymentV2 = require('./models/PaymentV2');
const amortizationEngine = require('./engines/amortizationEngine');
require('dotenv').config();

async function run() {
    console.log("Starting script...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to DB...");
    const loan = await Loan.findById('6927e04d312573d65d1d4590');
    if (!loan) {
        console.error('Loan not found');
        process.exit(1);
    }

    // Q1-Q5: 2000 Pagado
    // Q6: 1000 Pagado (Penalidad)
    // Q7: 2000 Pagado
    // Q8-Q17: 2000 Pendiente
    const basisQ = loan.schedule[0];
    const capitalFixed = basisQ.principalAmount || basisQ.capital;
    const interestFixed = basisQ.interestAmount || basisQ.interest;
    const balanceStart = loan.amount;

    console.log("Basis Capital:", parseFloat(capitalFixed));
    console.log("Basis Interest:", parseFloat(interestFixed));

    const newSchedule = [];

    for (let i = 0; i < 5; i++) {
        const q = loan.schedule[i];
        q.status = 'paid';
        newSchedule.push(q);
    }

    const penaltyQ = loan.schedule.find(q => parseFloat(q.amount) === 1000 && q.status === 'paid' && q.number === 6) || loan.schedule[5];
    penaltyQ.status = 'paid';
    penaltyQ.amount = mongoose.Types.Decimal128.fromString("1000.00");
    penaltyQ.interestAmount = mongoose.Types.Decimal128.fromString("1000.00");
    penaltyQ.principalAmount = mongoose.Types.Decimal128.fromString("0.00");
    penaltyQ.paidAmount = mongoose.Types.Decimal128.fromString("1000.00");
    penaltyQ.interestPaid = mongoose.Types.Decimal128.fromString("1000.00");
    penaltyQ.notes = " [Penalidad Aplicada]";
    penaltyQ.number = 6;
    newSchedule.push(penaltyQ);

    let q7 = loan.schedule.find(q => parseFloat(q.amount) === 2000 && q.status === 'paid' && q.number > 5 && q.number !== 6);
    if (!q7) {
        q7 = loan.schedule[6];
        if (!q7) {
            console.error("Missing Q7"); process.exit(1);
        }
        q7.status = 'paid';
        q7.paidAmount = q7.amount;
    }
    q7.number = 7;
    newSchedule.push(q7);

    let lastDueDate = q7.dueDate;

    let currentBalance = parseFloat(balanceStart);
    for (let i = 0; i < 7; i++) {
        if (parseFloat(newSchedule[i].principalAmount || 0) > 0 && newSchedule[i].status === 'paid') {
            currentBalance -= parseFloat(newSchedule[i].principalAmount || 0);
        }
    }

    for (let i = 8; i <= 17; i++) {
        console.log("Generating quota", i);
        lastDueDate = amortizationEngine.getNextDueDate(lastDueDate, loan.frequency);
        const q = {
            number: i,
            dueDate: lastDueDate,
            amount: mongoose.Types.Decimal128.fromString("2000.00"),
            principalAmount: capitalFixed,
            interestAmount: interestFixed,
            balance: mongoose.Types.Decimal128.fromString(Math.max(0, currentBalance - parseFloat(capitalFixed)).toFixed(2)),
            status: 'pending',
            daysOfGrace: 0,
            paidAmount: mongoose.Types.Decimal128.fromString("0.00"),
            interestPaid: mongoose.Types.Decimal128.fromString("0.00"),
            capitalPaid: mongoose.Types.Decimal128.fromString("0.00")
        };
        newSchedule.push(q);
        currentBalance -= parseFloat(capitalFixed);
    }

    loan.schedule = newSchedule;
    loan.duration = 17;

    let interestTotal = 0;
    let interestPaid = 0;
    loan.schedule.forEach(q => {
        interestTotal += parseFloat(q.interestAmount);
        if (q.status === 'paid') {
            interestPaid += parseFloat(q.interestAmount);
        }
    });

    if (!loan.financialModel) loan.financialModel = {};
    loan.financialModel.interestTotal = interestTotal;
    loan.financialModel.interestPaid = interestPaid;

    loan.markModified('schedule');
    loan.markModified('financialModel');
    await loan.save();

    console.log("Loan successfully healed! Duration:", loan.duration);
    process.exit(0);
}
run();
