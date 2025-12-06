const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config({ path: './backend/.env' });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('Connected to MongoDB');

        const users = await User.find({
            name: { $regex: /starlyn/i }
        });

        if (users.length === 0) {
            console.log('No user found matching "Starlyn"');
        } else {
            users.forEach(u => console.log(`Found User: ${u.name} - ID: ${u._id} - Role: ${u.role}`));
        }
        process.exit();
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
