require('dotenv').config();
const mongoose = require('mongoose');
const Client = require('./models/Client');
const Wallet = require('./models/Wallet');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

const fakeNames = [
    "Juan Pérez", "María Rodríguez", "Pedro Gómez", "Ana López", "Carlos Martínez",
    "Laura Sánchez", "José Fernández", "Elena Ramírez", "Miguel Torres", "Sofía Díaz",
    "David Ruiz", "Lucía Morales", "Javier Romero", "Paula Herrera", "Diego Castro"
];

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('🌱 Sembrando 15 Clientes Falsos...');

        // 1. Obtener BusinessId válido
        const wallet = await Wallet.findOne();
        if (!wallet) {
            console.error('❌ No se encontró ninguna caja (Wallet) para obtener el BusinessId.');
            process.exit(1);
        }
        const businessId = wallet.businessId;
        console.log(`🏢 Usando BusinessId: ${businessId}`);

        // 2. Crear Clientes
        const clients = fakeNames.map((name, index) => ({
            businessId: businessId,
            name: name,
            address: `Calle ${index + 1} #10${index}, Sector Simulado`,
            phone: `809-555-${1000 + index}`,
            occupation: index % 2 === 0 ? 'Comerciante' : 'Empleado',
            income: 15000 + (index * 1000),
            status: 'active',
            balance: 0
        }));

        await Client.insertMany(clients);
        console.log('✅ 15 Clientes insertados correctamente.');

        process.exit();
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
