const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const verifyStats = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });
        const businessId = user.businessId;

        const portfolioStats = await Loan.aggregate([
            { $match: { status: 'active', businessId: businessId } },
            {
                $group: {
                    _id: null,
                    totalBalance: { $sum: "$balance" },
                    totalCurrentCapital: { $sum: "$currentCapital" },
                    totalInterest: { $sum: { $subtract: ["$totalToPay", "$amount"] } }
                }
            }
        ]);

        const pStats = portfolioStats[0] || { totalBalance: 0, totalInterest: 0, totalCurrentCapital: 0 };

        console.log('--- Portfolio Stats ---');
        console.log('Total Balance (Active Portfolio):', pStats.totalBalance);
        console.log('Total Current Capital (Active Capital):', pStats.totalCurrentCapital);
        console.log('Active Interest (Balance - Capital):', pStats.totalBalance - pStats.totalCurrentCapital);
        console.log('Projected Profit (Total Lifetime Interest):', pStats.totalInterest);

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

verifyStats();
