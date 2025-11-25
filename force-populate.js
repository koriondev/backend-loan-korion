require('dotenv').config();
const mongoose = require('mongoose');
const Client = require('./models/Client');
const Loan = require('./models/Loan');
const Wallet = require('./models/Wallet');

// TU ID DE EMPRESA (Copiado del log que me mandaste)
const MY_BUSINESS_ID = '692493aa64fd1accb7101187';

mongoose.connect('mongodb://localhost:27017/korionloan')
  .then(async () => {
    console.log(`💉 Inyectando datos a la empresa: ${MY_BUSINESS_ID}...`);

    // 1. Asegurar que haya una Cartera
    let wallet = await Wallet.findOne({ businessId: MY_BUSINESS_ID });
    if (!wallet) {
        console.log('💰 Creando Cartera Principal...');
        wallet = await Wallet.create({
            name: 'Caja Principal',
            balance: 1000000,
            isDefault: true,
            businessId: MY_BUSINESS_ID
        });
    } else {
        console.log('✅ Cartera encontrada.');
    }

    // 2. Crear 10 Clientes
    console.log('👥 Creando 10 Clientes...');
    const clients = [];
    for (let i = 1; i <= 10; i++) {
        const client = await Client.create({
            name: `Cliente Nuevo ${i}`,
            address: `Calle ${i}, Sector Centro`,
            phone: `809-555-${1000 + i}`,
            occupation: 'Empleado',
            income: 25000,
            status: 'active',
            balance: 0,
            businessId: MY_BUSINESS_ID, // <--- LA CLAVE
            createdAt: new Date()
        });
        clients.push(client);
    }

    // 3. Crear 5 Préstamos
    console.log('📄 Creando 5 Préstamos Activos...');
    for (let i = 0; i < 5; i++) {
        const amount = 20000;
        const totalPay = 24000;
        
        // Generar schedule simple
        const schedule = [];
        for(let j=1; j<=12; j++) {
            schedule.push({
                number: j,
                dueDate: new Date(new Date().setDate(new Date().getDate() + (j*7))),
                amount: 2000,
                capital: 1666,
                interest: 334,
                status: 'pending'
            });
        }

        await Loan.create({
            client: clients[i]._id,
            amount: amount,
            interestRate: 20,
            duration: 12,
            frequency: 'weekly',
            type: 'simple',
            status: 'active',
            totalToPay: totalPay,
            balance: totalPay,
            schedule: schedule,
            businessId: MY_BUSINESS_ID, // <--- LA CLAVE
            createdAt: new Date()
        });

        // Actualizar saldo del cliente
        await Client.findByIdAndUpdate(clients[i]._id, { balance: totalPay });
    }

    console.log('✅ ¡Inyección Completada! Recarga la página.');
    process.exit();
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
