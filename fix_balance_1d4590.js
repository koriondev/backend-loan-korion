const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const fixBalance = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });
        const allLoans = await Loan.find({ businessId: user.businessId });
        const loan = allLoans.find(l => l._id.toString().endsWith('1d4590'));

        if (!loan) {
            console.error('❌ Préstamo no encontrado');
            process.exit(1);
        }

        console.log(`Balance actual: ${loan.balance}`);

        // Recalcular balance basado en el schedule
        const totalExpected = loan.schedule.reduce((acc, q) => acc + q.amount, 0);
        const totalPaid = loan.schedule.reduce((acc, q) => acc + (q.paidAmount || 0), 0);
        const correctBalance = totalExpected - totalPaid;

        console.log(`Total Esperado: ${totalExpected}`);
        console.log(`Total Pagado: ${totalPaid}`);
        console.log(`Balance Correcto: ${correctBalance}`);

        if (loan.balance !== correctBalance) {
            loan.balance = correctBalance;
            await loan.save();
            console.log('✅ Balance corregido correctamente');
        } else {
            console.log('✅ El balance ya es correcto');
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

fixBalance();
