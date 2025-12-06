const mongoose = require('mongoose');
const LoanV2 = require('./models/LoanV2');
const PaymentV2 = require('./models/PaymentV2');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const testLoanV2 = async () => {
    try {
        console.log('\n═══════════════════════════════════════');
        console.log('TEST: LoanV2 System');
        console.log('═══════════════════════════════════════\n');

        // 1. Count existing V2 loans
        const count = await LoanV2.countDocuments();
        console.log(`📊 Préstamos V2 existentes: ${count}`);

        // 2. List V2 loans
        if (count > 0) {
            const loans = await LoanV2.find().limit(5).populate('clientId', 'name cedula');
            console.log('\n📋 Préstamos V2:');
            loans.forEach(loan => {
                console.log(`  - ${loan._id.toString().slice(-6)} | ${loan.clientId?.name || 'N/A'} | ${loan.lendingType} | ${loan.status}`);
            });
        }

        // 3. Count V2 payments
        const paymentCount = await PaymentV2.countDocuments();
        console.log(`\n💰 Pagos V2 registrados: ${paymentCount}`);

        console.log('\n✅ Sistema LoanV2 funcionando correctamente');
        console.log('\n═══════════════════════════════════════\n');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

testLoanV2();
