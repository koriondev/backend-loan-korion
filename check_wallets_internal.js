const mongoose = require('mongoose');
const Wallet = require('./models/Wallet');
require('dotenv').config();

async function checkWallets() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connected to DB");

        const admin = await mongoose.model('User', require('./models/User').schema).findOne({ role: 'admin' });
        if (!admin) {
            console.log("No admin found!");
            process.exit(1);
        }
        console.log("Assigning legacy wallets to Admin:", admin.name, admin._id);

        const wallets = await Wallet.find({ ownerId: { $exists: false } });
        console.log("Wallets to fix:", wallets.length);

        for (const w of wallets) {
            w.ownerId = admin._id;
            await w.save();
            console.log(`Fixed wallet: ${w.name}`);
        }

        // Also check for undefined/null explicitly
        const nullWallets = await Wallet.find({ ownerId: null });
        for (const w of nullWallets) {
            w.ownerId = admin._id;
            await w.save();
            console.log(`Fixed null wallet: ${w.name}`);
        }

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkWallets();
