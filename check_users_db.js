const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('Connected to MongoDB');
        const User = require('./models/User');
        const users = await User.find({});
        console.log(`Found ${users.length} users`);
        users.forEach(u => {
            console.log(`User: ${u.email}, Role: ${u.role}, BusinessId: ${u.businessId}`);
        });
        mongoose.disconnect();
    })
    .catch(err => {
        console.error('Error:', err);
        process.exit(1);
    });
