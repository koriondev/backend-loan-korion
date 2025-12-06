const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
    .then(async () => {
        const loans = await Loan.find({}).populate('client');
        console.log('--- Loans with Clients ---');
        loans.forEach(l => {
            const clientName = l.client ? l.client.name : 'UNKNOWN_CLIENT';
            console.log(`Loan ${l._id}: Client=${clientName}, Amount=${l.amount}, Status=${l.status}`);
        });
        process.exit();
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
