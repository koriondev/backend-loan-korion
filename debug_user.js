const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

async function checkLastUser() {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion-loan');
    const user = await User.findOne().sort({ createdAt: -1 });
    console.log('Last Created User:');
    console.log({
        email: user.email,
        status: user.status,
        passwordExists: !!user.password,
        isActive: user.isActive,
        role: user.role
    });
    process.exit();
}

checkLastUser();
