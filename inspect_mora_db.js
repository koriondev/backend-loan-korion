const mongoose = require('mongoose');
const Loan = require('./models/Loan');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const inspectLoan = async () => {
    try {
        const loanId = '692d2c339ee6c7e138429116';
        const loan = await Loan.findById(loanId);

        if (!loan) {
            console.log('Loan not found');
            process.exit(1);
        }

        console.log('═══════════════════════════════════════');
        console.log(`LOAN #${loan._id}`);
        console.log('═══════════════════════════════════════');
        console.log(`Status: ${loan.status}`);
        console.log(`Balance: ${loan.balance}`);
        console.log(`Paid Late Fee (DB): ${loan.paidLateFee}`);

        console.log('\n--- SCHEDULE STATUS ---');
        loan.schedule.forEach(q => {
            console.log(`  #${q.number} - ${new Date(q.dueDate).toLocaleDateString()} - ${q.status}`);
        });

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

inspectLoan();
