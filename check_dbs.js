const mongoose = require('mongoose');
const User = require('./models/User');

const dbs = ['korionloan', 'korion_db', 'admin', 'local'];

async function checkDb(dbName) {
    try {
        const conn = await mongoose.createConnection(`mongodb://127.0.0.1:27017/${dbName}`).asPromise();
        console.log(`\n--- Database: ${dbName} ---`);

        // Try to find users collection directly if model not matching schema perfectly? 
        // Or just use the model. The model calculates collection name usually as 'users'.
        const collections = await conn.db.listCollections().toArray();
        console.log('Collections:', collections.map(c => c.name).join(', '));

        if (collections.find(c => c.name === 'users')) {
            const count = await conn.collection('users').countDocuments();
            console.log(`Users count: ${count}`);
            if (count > 0) {
                const firstUser = await conn.collection('users').findOne({});
                console.log('First User:', firstUser.email, firstUser.name);
            }
        } else {
            console.log('No users collection.');
        }
        await conn.close();
    } catch (e) {
        console.log(`Error checking ${dbName}: ${e.message}`);
    }
}

async function main() {
    for (const db of dbs) {
        await checkDb(db);
    }
    process.exit(0);
}

main();
