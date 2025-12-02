const mongoose = require('mongoose');
const User = require('./models/User');
const Client = require('./models/Client');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const addFakeClients = async () => {
    try {
        // Find user by email (lowercase)
        const user = await User.findOne({ email: 'duartecoronajeffrynoel@gmail.com' });

        if (!user) {
            console.error('❌ Usuario no encontrado');
            process.exit(1);
        }

        console.log(`✅ Usuario encontrado: ${user.name}`);
        console.log(`   BusinessId: ${user.businessId}`);

        const businessId = user.businessId;

        // Dominican names and data
        const dominicanClients = [
            { firstName: 'Juan', lastName: 'Pérez Martínez', street: 'Duarte' },
            { firstName: 'María', lastName: 'González Rodríguez', street: 'Independencia' },
            { firstName: 'Pedro', lastName: 'Ramírez Santos', street: 'Mella' },
            { firstName: 'Ana', lastName: 'Díaz Fernández', street: 'Las Mercedes' },
            { firstName: 'Luis', lastName: 'Torres García', street: 'La Fe' },
            { firstName: 'Carmen', lastName: 'Jiménez López', street: 'Los Mina' },
            { firstName: 'José', lastName: 'Hernández Cruz', street: 'Villa Juana' },
            { firstName: 'Rosa', lastName: 'Mejía Valdez', street: 'Los Tres Brazos' },
            { firstName: 'Carlos', lastName: 'Sánchez Reyes', street: 'Cristo Rey' },
            { firstName: 'Lucía', lastName: 'Castillo Moreno', street: 'Villa Consuelo' }
        ];

        const clients = [];

        for (let i = 0; i < 10; i++) {
            const data = dominicanClients[i];
            const cedula = `402-${(2000000 + i * 11111).toString().padStart(7, '0')}-${i}`;
            const phone = `809-${(200 + i * 10).toString().padStart(3, '0')}-${(1000 + i * 100).toString()}`;
            const number = 10 + i * 20;
            const monthlyIncome = 15000 + (i * 3000); // 15k - 42k RD$

            const client = {
                businessId,
                firstName: data.firstName,
                lastName: data.lastName,
                name: `${data.firstName} ${data.lastName}`,
                cedula,
                phone,
                address: `Calle ${data.street} #${number}, Santo Domingo`,
                monthlyIncome,
                balance: 0,
                references: [
                    {
                        name: `Referencia de ${data.firstName}`,
                        phone: `809-${(300 + i * 10).toString().padStart(3, '0')}-${(2000 + i * 100).toString()}`,
                        relationship: i % 3 === 0 ? 'Familiar' : i % 3 === 1 ? 'Amigo' : 'Compañero de trabajo'
                    }
                ]
            };

            clients.push(client);
        }

        // Insert clients
        const result = await Client.insertMany(clients);

        console.log(`\n✅ ${result.length} clientes agregados exitosamente:`);
        result.forEach((client, index) => {
            console.log(`   ${index + 1}. ${client.name.padEnd(30)} | ${client.cedula} | ${client.phone}`);
        });

        console.log('\n✅ Proceso completado');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

// Run
addFakeClients();
