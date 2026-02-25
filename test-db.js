const mongoose = require('mongoose');
const Wallet = require('./models/Wallet');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    const wallets = await Wallet.find().sort({ createdAt: -1 }).limit(3);
    console.log(wallets.map(w => ({ name: w.name, currency: w.currency })));
    mongoose.disconnect();
  })
  .catch(console.error);
