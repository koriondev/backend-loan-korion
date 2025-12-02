const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const inspectLoans = async () => {
    try {
        const loans = await Loan.find({}).populate('client');

        console.log('Fecha actual del sistema (UTC):', new Date().toISOString());
        console.log('Fecha actual del sistema (Local):', new Date().toString());

        // Check specific loan #1d76c8
        const loan76c8 = loans.find(l => l._id.toString().endsWith('1d76c8'));
        if (loan76c8) {
            console.log('\n═══════════════════════════════════════');
            console.log(`PRÉSTAMO #1d76c8 (${loan76c8.client?.name})`);
            const nextQuota = loan76c8.schedule.find(q => q.status === 'pending');
            if (nextQuota) {
                console.log(`Próxima Cuota (#${nextQuota.number}):`);
                console.log(`  DueDate (DB): ${nextQuota.dueDate}`);
                console.log(`  DueDate (ISO): ${new Date(nextQuota.dueDate).toISOString()}`);
                console.log(`  DueDate (Local): ${new Date(nextQuota.dueDate).toString()}`);
            } else {
                console.log('No hay cuotas pendientes.');
            }
        }

        // Find all loans due on 2025-12-02
        console.log('\n═══════════════════════════════════════');
        console.log('PRÉSTAMOS CON FECHA 2025-12-02 (UTC +/- 1 day range):');

        const targetDate = new Date('2025-12-02T00:00:00Z');
        const start = new Date(targetDate); start.setDate(start.getDate() - 1);
        const end = new Date(targetDate); end.setDate(end.getDate() + 1);

        let count = 0;
        for (const loan of loans) {
            const nextQuota = loan.schedule.find(q => q.status === 'pending');
            if (nextQuota) {
                const d = new Date(nextQuota.dueDate);
                if (d >= start && d <= end) {
                    console.log(`- ${loan._id.toString().slice(-6)} (${loan.client?.name}): ${d.toISOString()} (${d.toDateString()})`);
                    count++;
                }
            }
        }
        console.log(`Total encontrados en rango: ${count}`);

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

inspectLoans();
