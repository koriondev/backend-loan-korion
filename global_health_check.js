const mongoose = require('mongoose');
require('dotenv').config();

const check = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Loan = require('./models/Loan');

        const loans = await Loan.find({ status: { $ne: 'archived' } });
        console.log(`Auditing ${loans.length} active loans...`);

        const discrepancies = [];

        loans.forEach(loan => {
            const getVal = (v) => v ? (v.$numberDecimal ? parseFloat(v.$numberDecimal) : (parseFloat(v) || 0)) : 0;

            const currentCap = getVal(loan.currentCapital);
            const interestPend = getVal(loan.financialModel?.interestPending);
            const systemBalance = currentCap + interestPend;

            let scheduleBalance = 0;
            if (loan.schedule) {
                loan.schedule.forEach(q => {
                    if (q.status !== 'paid') {
                        const qTotal = getVal(q.principalAmount || q.capital) + getVal(q.interestAmount || q.interest);
                        const qPaid = getVal(q.paidAmount);
                        scheduleBalance += Math.max(0, qTotal - qPaid);
                    }
                });
            }

            const diff = Math.abs(systemBalance - scheduleBalance);
            if (diff > 5) { // more than 5 pesos diff
                discrepancies.push({
                    id: loan._id.toString().slice(-6),
                    client: loan.clientName || 'Unknown',
                    system: systemBalance.toFixed(2),
                    schedule: scheduleBalance.toFixed(2),
                    diff: (systemBalance - scheduleBalance).toFixed(2)
                });
            }
        });

        if (discrepancies.length > 0) {
            console.log("Found Discrepancies (System vs Schedule):");
            console.table(discrepancies);
        } else {
            console.log("All loans are in sync (System Balance == Schedule Balance).");
        }

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
check();
