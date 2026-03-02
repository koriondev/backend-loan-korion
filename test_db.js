const mongoose = require('mongoose');
require('dotenv').config();

const test = async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const Loan = require('./models/Loan');
    const Settings = require('./models/Settings');
    const { calculatePenaltyV3, getOverduePeriods } = require('./engines/penaltyEngine');

    // Find "Mama del chino" logic: usually amount 20000, 16 duration
    const loan = await Loan.findOne({ amount: 20000, duration: 16 }).sort({ createdAt: -1 });
    if (!loan) {
        console.log("No loan found");
        process.exit(0);
    }
    const settings = await Settings.findOne({ businessId: loan.businessId });

    console.log("Oldest due date:", loan.schedule.find(s => s.status !== 'paid')?.dueDate);
    console.log("Now:", new Date());

    const penalty = calculatePenaltyV3(loan, settings, new Date());
    console.log("Total Penalty Calculated via engine:", penalty.totalPenalty);
    console.log("Periods Overdue:", penalty.periodsOverdue);

    // Let's manually run getOverduePeriods
    const dObj = new Date(loan.schedule.find(s => s.status !== 'paid')?.dueDate);
    console.log("getOverduePeriods returns:", getOverduePeriods(dObj, 'daily', 0, settings, new Date()));

    process.exit(0);
}
test();
