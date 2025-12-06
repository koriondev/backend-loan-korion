const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Settings = require('./models/Settings');
require('dotenv').config();

// Copy-paste calculateLateFee logic for testing or import it if possible
// I'll import the controller logic if I can, or just replicate it to verify DB state impact.
// Better to replicate the logic to see what the DB state implies.

const calculateLateFee = (loan, overdueCount, settings) => {
    if (!loan.penaltyConfig || overdueCount <= 0) return 0;
    const { type, value, gracePeriod = 0 } = loan.penaltyConfig;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Simplified working day check (assume all working for test unless settings exist)
    const isWorkingDay = (date) => {
        // ... (omitted for brevity, assuming standard)
        return true;
    };

    // Find oldest overdue
    const overdueQuotas = loan.schedule.filter(q => {
        if (q.status !== 'pending') return false;
        const dueDate = new Date(q.dueDate);
        return dueDate < startOfToday;
    });

    if (overdueQuotas.length === 0) return 0;

    const oldestOverdue = overdueQuotas[0];
    const originalDueDate = new Date(oldestOverdue.dueDate);

    // Grace logic...
    let currentDate = new Date(originalDueDate);
    currentDate.setDate(currentDate.getDate() + gracePeriod + 1);

    let workingDaysOverdue = 0;
    while (currentDate < startOfToday) {
        workingDaysOverdue++;
        currentDate.setDate(currentDate.getDate() + 1);
    }

    if (type === 'fixed') {
        return value * workingDaysOverdue;
    }
    return 0;
};

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const verifyMora = async () => {
    try {
        const loanId = '692d2c339ee6c7e138429116';
        const loan = await Loan.findById(loanId);
        const settings = await Settings.findOne({ businessId: loan.businessId });

        console.log(`Loan Status: ${loan.status}`);
        console.log(`Paid Quotas: ${loan.schedule.filter(q => q.status === 'paid').length}`);
        console.log(`Pending Quotas: ${loan.schedule.filter(q => q.status === 'pending').length}`);

        const overdueCount = loan.schedule.filter(q => q.status === 'pending' && new Date(q.dueDate) < new Date()).length;
        console.log(`Overdue Count: ${overdueCount}`);

        const mora = calculateLateFee(loan, overdueCount, settings);
        console.log(`Calculated Mora: ${mora}`);

        const paidMora = loan.paidLateFee || 0;
        console.log(`Paid Mora (DB): ${paidMora}`);

        console.log(`Net Mora to Pay: ${Math.max(0, mora - paidMora)}`);

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

verifyMora();
