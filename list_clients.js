const mongoose = require('mongoose');
const Client = require('./models/Client');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
    .then(async () => {
        const clients = await Client.find({}, 'name');
        console.log('--- Clients ---');
        clients.forEach(c => console.log(c.name));
        process.exit();
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
