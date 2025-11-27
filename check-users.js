require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
    .then(async () => {
        const users = await User.find({});
        console.log('Users found:', users.length);
        users.forEach(u => console.log(`- ${u.email} (${u.role})`));
        process.exit();
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
