const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./models/User');

const run = async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const usersWithToken = await User.find({ telegramAuthToken: { $ne: null } });
    console.log("Users with token:", usersWithToken.map(u => ({ email: u.email, token: u.telegramAuthToken, expires: u.telegramAuthExpires })));
    process.exit(0);
};

run();
