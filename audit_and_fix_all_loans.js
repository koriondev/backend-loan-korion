const mongoose = require('mongoose');
require('dotenv').config();

const audit = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Client = require('./models/Client');
        const Loan = require('./models/Loan');

        const loans = await Loan.find({ status: { $ne: 'archived' } }).populate('clientId');
        console.log(`Auditing ${loans.length} active loans...`);

        const issues = [];

        loans.forEach(loan => {
            const getVal = (v) => v ? (v.$numberDecimal ? parseFloat(v.$numberDecimal) : (parseFloat(v) || 0)) : 0;

            const initial = loan.initialDuration || 0;
            const schedule = loan.schedule || [];

            // Count how many "shifts" (Gana Tiempo) happened
            const shiftCount = schedule.filter(q => q.notes && q.notes.includes("[Penalidad Aplicada]")).length;

            const expectedLength = initial > 0 ? (initial + shiftCount) : schedule.length;
            const actualLength = schedule.length;

            const durationMismatch = initial > 0 && actualLength < expectedLength;

            // Balance check
            const currentCap = getVal(loan.currentCapital);
            const interestPend = getVal(loan.financialModel?.interestPending);
            const systemBalance = currentCap + interestPend;

            let scheduleBalance = 0;
            schedule.forEach(q => {
                if (q.status !== 'paid') {
                    const qTotal = getVal(q.principalAmount || q.capital) + getVal(q.interestAmount || q.interest);
                    const qPaid = getVal(q.paidAmount);
                    scheduleBalance += Math.max(0, qTotal - qPaid);
                }
            });

            const balanceMismatch = Math.abs(systemBalance - scheduleBalance) > 10;

            if (durationMismatch || balanceMismatch) {
                issues.push({
                    id: loan._id.toString().slice(-6),
                    client: loan.clientId?.name || 'Unknown',
                    initialDur: initial,
                    shifts: shiftCount,
                    expLen: expectedLength,
                    actLen: actualLength,
                    sysBal: systemBalance.toFixed(2),
                    schBal: scheduleBalance.toFixed(2),
                    diff: (systemBalance - scheduleBalance).toFixed(2),
                    status: loan.status
                });
            }
        });

        if (issues.length > 0) {
            console.log("Loans with Potential Issues (Missing installments or balance desync):");
            console.table(issues);
        } else {
            console.log("No systemic issues found in active loans.");
        }

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
audit();
