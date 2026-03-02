const mongoose = require('mongoose');
require('dotenv').config();

const test = async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    const Loan = require('./models/Loan');
    const loan = await Loan.findOne({ "client": { $exists: false } }).sort({createdAt: -1}); // just get recent
    if(loan) {
        console.log("Recent loan lateFee/penaltyConfig:", loan.penaltyConfig);
        console.log("paidPenalty?", loan.penaltyConfig?.paidPenalty);
    }
    process.exit(0);
}
test();
