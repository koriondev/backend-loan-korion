const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const updatePartialStatuses = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });

        const loans = await Loan.find({ businessId: user.businessId });

        let updatedCount = 0;

        for (const loan of loans) {
            let hasChanges = false;

            for (const quota of loan.schedule) {
                if (quota.status === 'pending' && quota.paidAmount > 0) {
                    // Esta cuota debería ser 'partial', no 'pending'
                    const totalExpected = quota.amount;
                    const isPaid = quota.paidAmount >= (totalExpected - 0.1);

                    if (!isPaid) {
                        console.log(`Actualizando cuota #${quota.number} del préstamo ${loan._id.toString().slice(-6)}`);
                        console.log(`  paidAmount: ${quota.paidAmount} de ${totalExpected}`);
                        quota.status = 'partial';
                        hasChanges = true;
                    }
                }
            }

            if (hasChanges) {
                loan.markModified('schedule');
                await loan.save();
                updatedCount++;
            }
        }

        console.log(`\n✅ Actualizados ${updatedCount} préstamos`);
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

updatePartialStatuses();
