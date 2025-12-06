const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('Connected to MongoDB');
        const Client = require('./models/Client');

        const businessIdStr = '6924cfba1c94e75f71abb864';
        console.log(`Searching for businessId: "${businessIdStr}" (string)`);

        const clients = await Client.find({ businessId: businessIdStr });
        console.log(`Found ${clients.length} clients with string ID`);

        const mongoose = require('mongoose');
        const businessIdObj = new mongoose.Types.ObjectId(businessIdStr);
        console.log(`Searching for businessId: ${businessIdObj} (ObjectId)`);

        const clientsObj = await Client.find({ businessId: businessIdObj });
        console.log(`Found ${clientsObj.length} clients with ObjectId`);

        mongoose.disconnect();
    })
    .catch(err => {
        console.error('Error:', err);
        process.exit(1);
    });
