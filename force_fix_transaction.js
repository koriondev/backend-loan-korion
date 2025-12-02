const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const fixTransactionProperly = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });

        // Encontrar la transacción por ID exacto
        const tx = await Transaction.findById('692da1cb8fabfe343992f6bf');

        if (!tx) {
            console.error('❌ Transacción no encontrada');
            process.exit(1);
        }

        console.log('ANTES:');
        console.log(JSON.stringify(tx.metadata, null, 2));

        // FORZAR la actualización
        tx.metadata = {
            loanId: tx.metadata?.loanId || '6927e69c312573d65d1d61c7',
            breakdown: {
                mora: 0,
                interest: 500,
                capital: 0
            }
        };

        // Marcar como modificado explícitamente
        tx.markModified('metadata');

        await tx.save();

        console.log('\nDESPUÉS:');
        console.log(JSON.stringify(tx.metadata, null, 2));

        // Verificar que se guardó
        const verified = await Transaction.findById('692da1cb8fabfe343992f6bf');
        console.log('\nVERIFICADO en DB:');
        console.log(JSON.stringify(verified.metadata, null, 2));

        console.log('\n✅ Actualización completada');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

fixTransactionProperly();
