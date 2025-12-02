const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Transaction = require('./models/Transaction');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const fixLoan1d4590 = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });

        // Buscar el préstamo
        const allLoans = await Loan.find({ businessId: user.businessId });
        const loan = allLoans.find(l => l._id.toString().endsWith('1d4590'));

        if (!loan) {
            console.error('❌ Préstamo #1d4590 no encontrado');
            process.exit(1);
        }

        console.log(`Préstamo encontrado: ${loan._id}`);
        console.log(`Mora actual (lateFee): ${loan.lateFee}`);

        // 1. Resetear lateFee del préstamo
        loan.lateFee = 0;

        // 2. Buscar transacciones con mora para este préstamo
        const transactions = await Transaction.find({
            businessId: user.businessId,
            $or: [
                { loan: loan._id },
                { 'metadata.loanId': loan._id.toString() },
                { description: { $regex: '1d4590' } }
            ],
            type: 'in_payment'
        });

        console.log(`Transacciones encontradas: ${transactions.length}`);

        for (const tx of transactions) {
            if (tx.metadata?.breakdown?.mora > 0) {
                console.log(`Corrigiendo transacción ${tx._id} con mora: ${tx.metadata.breakdown.mora}`);

                // Reasignar mora a capital o interés, o simplemente eliminarla?
                // Asumiremos que si se cobró mora erróneamente, ese dinero debe ir a capital/interés o quedar como saldo a favor.
                // Por simplicidad y seguridad, moveremos el monto de la mora al capital (o interés si hay pendiente).

                const moraAmount = tx.metadata.breakdown.mora;
                tx.metadata.breakdown.mora = 0;

                // Distribuir el monto de la mora al capital
                tx.metadata.breakdown.capital = (tx.metadata.breakdown.capital || 0) + moraAmount;

                // Actualizar descripción
                tx.description = tx.description.replace(/Mora: \d+/, 'Mora: 0');

                tx.markModified('metadata');
                await tx.save();
            }
        }

        await loan.save();
        console.log('✅ Préstamo corregido: Mora eliminada.');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

fixLoan1d4590();
