const mongoose = require('mongoose');
require('dotenv').config();

const audit = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        require('./models/Client');
        const Loan = require('./models/Loan');

        const loans = await Loan.find({ status: { $ne: 'archived' } }).populate('clientId');
        console.log(`Auditing ${loans.length} active loans...`);

        const getVal = (v) => v ? (v.$numberDecimal ? parseFloat(v.$numberDecimal) : (parseFloat(v) || 0)) : 0;

        loans.forEach(loan => {
            const shortId = loan._id.toString().slice(-6);
            if (shortId === '3ed3b3') {
                console.log("\n--- Audit for #3ed3b3 (Target) ---");
                const currentCap = getVal(loan.currentCapital);
                const interestPend = getVal(loan.financialModel?.interestPending);
                const systemTotal = currentCap + interestPend;

                let scheduleTotal = 0;
                loan.schedule.forEach(q => {
                    if (q.status !== 'paid') {
                        const total = getVal(q.amount);
                        const paid = getVal(q.paidAmount);
                        scheduleTotal += (total - paid);
                    }
                });

                console.log(`System Total (P+I): ${systemTotal.toFixed(2)}`);
                console.log(`Schedule Total: ${scheduleTotal.toFixed(2)}`);
                console.log(`Difference: ${(systemTotal - scheduleTotal).toFixed(2)}`);
                console.log(`Expected Balance (User): 18997.92`);
            }
        });

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
audit();
