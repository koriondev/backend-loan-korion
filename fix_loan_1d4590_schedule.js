const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Transaction = require('./models/Transaction');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const fixLoan = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });
        const allLoans = await Loan.find({ businessId: user.businessId });
        const loan = allLoans.find(l => l._id.toString().endsWith('1d4590'));

        if (!loan) {
            console.error('❌ Préstamo no encontrado');
            process.exit(1);
        }

        console.log(`Procesando préstamo ${loan._id}...`);

        // 1. Buscar la transacción de pago por ID específico (encontrado en inspección previa)
        const tx = await Transaction.findById('692d9eb98fabfe343992f486');

        if (!tx) {
            console.error('❌ No se encontró la transacción por ID');
            process.exit(1);
        }
        console.log(`Transacción encontrada: ${tx._id}`);

        // 2. Vincular transacción al préstamo correctamente
        tx.loan = loan._id;
        await tx.save();
        console.log('✅ Transacción vinculada correctamente');

        // 3. Corregir el Schedule del Préstamo
        // La transacción fue de 2000. El breakdown dice: Int 750, Cap 1250.
        // La cuota #1 es de 2000.

        const quota = loan.schedule.find(q => q.number === 1);
        if (quota) {
            console.log(`Estado actual cuota #1: ${quota.status}, Pagado: ${quota.paidAmount}`);

            // Actualizar valores
            quota.paidAmount = 2000;
            quota.paidInterest = 750;
            quota.paidCapital = 1250; // 2000 - 750
            quota.status = 'paid';
            quota.paidDate = tx.date;

            console.log(`Nuevo estado cuota #1: ${quota.status}, Pagado: ${quota.paidAmount}`);

            loan.markModified('schedule');
            await loan.save();
            console.log('✅ Schedule del préstamo actualizado');
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

fixLoan();
