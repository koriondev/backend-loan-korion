const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    const Client = require('./models/Client');
    const clients = await Client.find({});
    console.log(`Found ${clients.length} clients`);
    if (clients.length > 0) {
      console.log('First client:', clients[0]);
    }
    mongoose.disconnect();
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
