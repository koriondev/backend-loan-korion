const mongoose = require('mongoose');
const User = require('./models/User');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
require('dotenv').config({ path: './backend/.env' });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('Connected to MongoDB');

        const user = await User.findOne({ name: 'Starlyn Acevedo' });
        if (!user) {
            console.log('User not found');
            process.exit();
        }

        console.log(`User: ${user.name}, BusinessID: ${user.businessId}`);

        const loans = await Loan.find({ businessId: user.businessId }).populate('client');

        let totalActiveCapital = 0;
        let totalActiveAmount = 0;

        console.log('--- Active Loans ---');
        loans.forEach(l => {
            if (l.status === 'active') {
                console.log(`Loan ${l._id} (${l.client?.name}): Amount=${l.amount}, CurrentCapital=${l.currentCapital}`);
                totalActiveCapital += (l.currentCapital || 0);
                totalActiveAmount += l.amount;
            }
        });

        console.log('--------------------');
        console.log(`Total Active Amount (Original): ${totalActiveAmount}`);
        console.log(`Total Active Current Capital: ${totalActiveCapital}`);

        // Check for other statuses that might be relevant
        console.log('--- Other Status Loans ---');
        loans.forEach(l => {
            if (l.status !== 'active') {
                console.log(`Loan ${l._id} (${l.client?.name}): Status=${l.status}, Amount=${l.amount}, CurrentCapital=${l.currentCapital}`);
            }
        });

        process.exit();
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
