const mongoose = require('mongoose');
require('dotenv').config();

const inspect = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Loan = require('./models/Loan');
        const Client = require('./models/Client');

        const loans = await Loan.find({ status: { $ne: 'archived' } }).populate('clientId');
        console.log(`Found ${loans.length} active/past_due loans.`);

        loans.slice(0, 10).forEach(l => {
            console.log(`ID: ${l._id.toString().slice(-6)} | Client: ${l.clientId?.name} | Duration: ${l.duration} | Schedule Len: ${l.schedule.length}`);
        });

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
inspect();
