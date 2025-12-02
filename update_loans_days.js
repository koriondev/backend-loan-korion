const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const updateLoanDays = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });
        const allLoans = await Loan.find({ businessId: user.businessId });

        const targets = [
            { id: '1d8a59', day: 2 }, // Tue
            { id: '1d61c7', day: 0 }, // Sun
            { id: '1d7ca3', day: 0 }, // Sun
            { id: '1d5f78', day: 0 }, // Sun
            { id: '1d5ade', day: 0 }, // Sun
            { id: '1d76c8', day: 2 }  // Tue
        ];

        console.log('Actualizando días de pago...');

        for (const target of targets) {
            const loan = allLoans.find(l => l._id.toString().toLowerCase().endsWith(target.id.toLowerCase()));

            if (loan) {
                console.log(`\nProcesando: ${loan._id} (${target.id})`);

                // Find first pending/partial quota
                const firstPendingIndex = loan.schedule.findIndex(q => q.status === 'pending' || q.status === 'partial');

                if (firstPendingIndex === -1) {
                    console.log('  ⚠️ No hay cuotas pendientes.');
                    continue;
                }

                // Calculate new start date for the first pending quota
                // We want the nearest target day.
                // If the current due date is close, we adjust it.
                // Strategy: Move to the *next* occurrence of the target day from the current due date.
                // If it's already the target day, keep it.

                let currentDueDate = new Date(loan.schedule[firstPendingIndex].dueDate);
                let daysUntilTarget = (target.day - currentDueDate.getDay() + 7) % 7;

                // If daysUntilTarget is 0, it's already the day.
                // If we want to force a move (e.g. if it was paid late?), no, just stick to schedule.
                // But wait, if it's "Tue" and currently "Thu", daysUntil = (2 - 4 + 7) % 7 = 5. So Thu + 5 = Tue.
                // This moves it to the *next* Tuesday.

                let newBaseDate = new Date(currentDueDate);
                newBaseDate.setDate(newBaseDate.getDate() + daysUntilTarget);

                console.log(`  Base Date: ${currentDueDate.toLocaleDateString()} -> New Start: ${newBaseDate.toLocaleDateString()}`);

                // Recalculate subsequent quotas
                let processDate = new Date(newBaseDate);

                for (let i = firstPendingIndex; i < loan.schedule.length; i++) {
                    const quota = loan.schedule[i];

                    // Set new date
                    quota.dueDate = new Date(processDate);

                    // Calculate next date based on frequency
                    if (loan.frequency === 'weekly') {
                        processDate.setDate(processDate.getDate() + 7);
                    } else if (loan.frequency === 'biweekly') {
                        processDate.setDate(processDate.getDate() + 15); // Or 14? Usually 15 or 14. "Quincenal" often implies 15 days or 1st/15th.
                        // Given the previous task about 1st/16th, biweekly is tricky.
                        // But these loans are "weekly" mostly.
                        // Let's check #1D7CA3 (Monthly).
                    } else if (loan.frequency === 'monthly') {
                        processDate.setMonth(processDate.getMonth() + 1);
                    } else if (loan.frequency === 'daily') {
                        processDate.setDate(processDate.getDate() + 1);
                    }

                    console.log(`    #${quota.number}: ${quota.dueDate.toLocaleDateString()}`);
                }

                loan.markModified('schedule');
                await loan.save();
                console.log('  ✅ Guardado.');

            } else {
                console.log(`\n❌ NO Encontrado: ${target.id}`);
            }
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

updateLoanDays();
