const mongoose = require('mongoose');

mongoose.connect('mongodb://localhost:27017/korionloan')
    .then(async () => {
        console.log('Connected to MongoDB');

        // Find the user
        const user = await mongoose.connection.db.collection('users').findOne({
            email: 'duartecoronajeffrynoel@gmail.com'
        });

        if (!user) {
            console.log('❌ User not found!');
            const allUsers = await mongoose.connection.db.collection('users').find({}).toArray();
            console.log('\nAvailable users:');
            allUsers.forEach(u => console.log(`- ${u.email} | Role: ${u.role} | BusinessID: ${u.businessId}`));
            process.exit(1);
        }

        console.log(`✅ User found: ${user.email}`);
        console.log(`   Role: ${user.role}`);
        console.log(`   BusinessID: ${user.businessId}`);

        // Find clients for this business
        const clients = await mongoose.connection.db.collection('clients').find({
            businessId: user.businessId
        }).toArray();

        console.log(`\n📋 Clients for this business: ${clients.length}`);
        clients.forEach(c => console.log(`- ${c.name} (BusinessID: ${c.businessId})`));

        // Find ALL clients
        const allClients = await mongoose.connection.db.collection('clients').find({}).toArray();
        console.log(`\n📋 Total clients in database: ${allClients.length}`);
        allClients.forEach(c => console.log(`- ${c.name} | BusinessID: ${c.businessId}`));

        process.exit(0);
    })
    .catch(err => {
        console.error('Error:', err.message);
        process.exit(1);
    });
