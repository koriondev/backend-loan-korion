const mongoose = require('mongoose');
const Loan = require('./models/Loan');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
    .then(async () => {
        const loan = await Loan.findOne({ status: 'active' });
        console.log(loan);
        process.exit();
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
