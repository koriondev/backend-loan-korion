const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const fixJoseRamonTransaction = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });

        // Buscar la transacción del 1 de diciembre de 500 pesos
        const transaction = await Transaction.findOne({
            businessId: user.businessId,
            amount: 500,
            type: 'in_payment',
            date: {
                $gte: new Date('2025-12-01T00:00:00Z'),
                $lte: new Date('2025-12-01T23:59:59Z')
            }
        });

        if (!transaction) {
            console.error('❌ Transacción no encontrada');
            process.exit(1);
        }

        console.log('✅ Transacción encontrada:');
        console.log(`   ID: ${transaction._id}`);
        console.log(`   Fecha: ${new Date(transaction.date).toLocaleString()}`);
        console.log(`   Monto: ${transaction.amount}`);
        console.log('\nANTES DE LA CORRECCIÓN:');
        if (transaction.metadata?.breakdown) {
            console.log(`   Mora: ${transaction.metadata.breakdown.mora || 0}`);
            console.log(`   Interés: ${transaction.metadata.breakdown.interest || 0}`);
            console.log(`   Capital: ${transaction.metadata.breakdown.capital || 0}`);
        }

        // CORREGIR EL BREAKDOWN
        if (!transaction.metadata) {
            transaction.metadata = {};
        }

        transaction.metadata.breakdown = {
            mora: 0,           // Era 25, ahora 0
            interest: 500,     // Era 475, ahora 500
            capital: 0
        };

        // Actualizar descripción sin mora
        transaction.description = transaction.description.replace('(Mora: 25)', '(Mora: 0)');

        await transaction.save();

        console.log('\nDESPUÉS DE LA CORRECCIÓN:');
        console.log(`   Mora: ${transaction.metadata.breakdown.mora}`);
        console.log(`   Interés: ${transaction.metadata.breakdown.interest}`);
        console.log(`   Capital: ${transaction.metadata.breakdown.capital}`);
        console.log(`\n✅ Transacción corregida. Recarga la página.`);

        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

fixJoseRamonTransaction();
