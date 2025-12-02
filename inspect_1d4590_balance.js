const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Transaction = require('./models/Transaction');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const inspectLoan = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });
        const allLoans = await Loan.find({ businessId: user.businessId });
        const loan = allLoans.find(l => l._id.toString().endsWith('1d4590'));

        if (!loan) {
            console.log('❌ Préstamo no encontrado');
            process.exit(1);
        }

        console.log('═══════════════════════════════════════');
        console.log(`PRÉSTAMO #${loan._id}`);
        console.log('═══════════════════════════════════════');
        console.log(`Monto Original: ${loan.amount}`);
        console.log(`Balance Actual (DB): ${loan.balance}`);
        console.log(`Late Fee: ${loan.lateFee}`);
        console.log(`Total a Pagar (DB): ${loan.totalToPay}`);

        let calculatedBalance = 0;
        let totalPaid = 0;
        let totalExpected = 0;

        console.log('\n📅 SCHEDULE:');
        loan.schedule.forEach(q => {
            totalExpected += q.amount;
            totalPaid += q.paidAmount || 0;
            if (q.status !== 'paid') {
                calculatedBalance += (q.amount - (q.paidAmount || 0));
            }

            if (q.number <= 3 || q.paidAmount > 0) {
                console.log(`  #${q.number} - Monto: ${q.amount} - Pagado: ${q.paidAmount} - Status: ${q.status}`);
            }
        });

        console.log('\n📊 CÁLCULOS:');
        console.log(`Total Esperado (Sum of quotas): ${totalExpected}`);
        console.log(`Total Pagado (Sum of paidAmount): ${totalPaid}`);
        console.log(`Balance Calculado (Expected - Paid): ${totalExpected - totalPaid}`);
        console.log(`Balance Calculado (Sum of pending): ${calculatedBalance}`);

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

inspectLoan();
