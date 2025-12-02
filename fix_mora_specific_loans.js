const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Transaction = require('./models/Transaction');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const fixLoans = async () => {
    try {
        // DATA TO FIX
        const fixes = [
            {
                loanId: '6927e85e312573d65d1d721b', // 1d721b
                txId: '692dc05c2023ecc31831815e',
                moraToRemove: 75,
                quotaNumber: 1
            },
            {
                loanId: '6927e313312573d65d1d4cdf', // 1d4cdf
                txId: '692dc0752023ecc31831817a',
                moraToRemove: 100,
                quotaNumber: 1
            }
        ];

        for (const fix of fixes) {
            console.log(`\nProcesando Préstamo ${fix.loanId}...`);

            // 1. Update Transaction
            const tx = await Transaction.findById(fix.txId);
            if (tx) {
                console.log(`  Transacción encontrada: ${tx._id}`);
                console.log(`  Breakdown Original:`, tx.metadata.breakdown);

                // Remove mora and add to capital
                tx.metadata.breakdown.mora = 0;
                tx.metadata.breakdown.capital += fix.moraToRemove;

                // Ensure loan link
                tx.loan = fix.loanId;

                tx.markModified('metadata');
                await tx.save();
                console.log(`  ✅ Breakdown Actualizado:`, tx.metadata.breakdown);
            } else {
                console.log(`  ❌ Transacción ${fix.txId} no encontrada`);
            }

            // 2. Update Loan Schedule
            const loan = await Loan.findById(fix.loanId);
            if (loan) {
                const quota = loan.schedule.find(q => q.number === fix.quotaNumber);
                if (quota) {
                    console.log(`  Cuota #${fix.quotaNumber} Original: Paid=${quota.paidAmount}, Cap=${quota.paidCapital}`);

                    quota.paidAmount += fix.moraToRemove;
                    quota.paidCapital += fix.moraToRemove;

                    // Check if fully paid now (likely yes, or close)
                    if (quota.paidAmount >= quota.amount) {
                        quota.status = 'paid';
                    }

                    loan.markModified('schedule');
                    await loan.save();
                    console.log(`  ✅ Cuota Actualizada: Paid=${quota.paidAmount}, Cap=${quota.paidCapital}, Status=${quota.status}`);
                }
            } else {
                console.log(`  ❌ Préstamo ${fix.loanId} no encontrado`);
            }
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

fixLoans();
