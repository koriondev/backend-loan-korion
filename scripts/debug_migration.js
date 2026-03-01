require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');
const PaymentV2 = require('../models/PaymentV2');

async function finalCheck() {
    await mongoose.connect(process.env.MONGO_URI);
    const targetBiz = '699e605cb31125334cd2ddc4';
    const count = await PaymentV2.countDocuments({ businessId: targetBiz });
    console.log(`Final PaymentV2 count in Target: ${count}`);
    process.exit(0);
}

finalCheck();
