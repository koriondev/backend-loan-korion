const mongoose = require('mongoose');
const Client = require('./models/Client');
require('dotenv').config({ path: './backend/.env' });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('Connected to MongoDB');

        const clients = await Client.find({
            $or: [
                { name: { $regex: /acevedo/i } },
                { firstName: { $regex: /acevedo/i } },
                { lastName: { $regex: /acevedo/i } }
            ]
        });

        if (clients.length === 0) {
            console.log('No client found matching "Starlyn"');
        } else {
            clients.forEach(c => console.log(`Found: ${c.name} (${c.firstName} ${c.lastName}) - ID: ${c._id}`));
        }
        process.exit();
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
