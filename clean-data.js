require('dotenv').config();
const mongoose = require('mongoose');
const Client = require('./models/Client');
const Loan = require('./models/Loan');
const Wallet = require('./models/Wallet');
const Transaction = require('./models/Transaction');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('🧹 Limpiando datos de negocio...');

        // 1. Borrar Datos Transaccionales
        await Loan.deleteMany({});
        console.log('✅ Préstamos eliminados');

        await Client.deleteMany({});
        console.log('✅ Clientes eliminados');

        await Transaction.deleteMany({});
        console.log('✅ Transacciones eliminadas');

        // 2. Resetear Caja (No borrar, para mantener businessId)
        await Wallet.updateMany({}, { balance: 5000000 });
        console.log('✅ Cajas reseteadas a 5,000,000');

        console.log('✨ Base de datos limpia y lista para simular.');
        process.exit();
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
