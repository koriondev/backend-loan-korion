const mongoose = require('mongoose');
require('dotenv').config();

const syncStatus = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Loan = require('./models/Loan');

        const loans = await Loan.find({ status: { $ne: 'archived' } });
        console.log(`Syncing status for ${loans.length} active loans...`);

        const now = new Date();
        now.setHours(23, 59, 59, 999);

        let updated = 0;
        for (const loan of loans) {
            const schedule = loan.schedule || [];

            // Lógica de Gana Tiempo (Seguro de Tiempo)
            const paidGTs = schedule.filter(q => q.status === 'paid' && q.notes && q.notes.includes("[Penalidad Aplicada]")).length;

            const allOverdue = schedule.filter(q => {
                if (q.status === 'paid') return false;
                return new Date(q.dueDate) < now;
            });

            // Consumir el seguro de tiempo (GT)
            const effectiveOverdue = allOverdue.slice(paidGTs);

            let daysLate = 0;
            if (effectiveOverdue.length > 0) {
                const first = new Date(effectiveOverdue[0].dueDate);
                const diff = Math.abs(now - first);
                daysLate = Math.floor(diff / (1000 * 60 * 60 * 24));
            }

            const newStatus = effectiveOverdue.length > 0 ? 'past_due' : 'active';

            // Solo guardar si hay cambio
            if (loan.status !== newStatus || loan.daysLate !== daysLate || loan.installmentsOverdue !== effectiveOverdue.length) {
                loan.status = newStatus;
                loan.daysLate = daysLate;
                loan.installmentsOverdue = effectiveOverdue.length;
                await loan.save({ validateBeforeSave: false });
                updated++;
            }
        }

        console.log(`Successfully updated status for ${updated} loans.`);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
syncStatus();
