const mongoose = require('mongoose');
require('dotenv').config();

const test = async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const Loan = require('./models/Loan');
    const Settings = require('./models/Settings');
    const { calculatePenaltyV3 } = require('./engines/penaltyEngine');

    // Find "Mama del chino" logic: usually amount 20000, 16 duration
    const loan = await Loan.findOne({ amount: 20000, duration: 16 }).sort({ createdAt: -1 });
    console.log("has financialModel:", !!loan.financialModel);
    console.log("penaltyConfig:", loan.penaltyConfig);
    process.exit(0);
}
test();
