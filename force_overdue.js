const mongoose = require('mongoose');
const Client = require('./models/Client');
const Loan = require('./models/Loan');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const forceOverdue = async () => {
    try {
        const user = await User.findOne({ email: 'duartecoronajeffrynoel@gmail.com' });

        // Buscar el préstamo de Cuota Fija de Marzo (el que tiene 8 cuotas y 0 pagadas)
        // LendingType: fixed, Duration: 8, Status: past_due o active
        const loan = await Loan.findOne({
            businessId: user.businessId,
            lendingType: 'fixed',
            duration: 8
        }).populate('client');

        if (!loan) {
            console.error('❌ No se encontró el préstamo objetivo');
            process.exit(1);
        }

        console.log(`✅ Préstamo encontrado: ${loan.client.name}`);
        console.log(`   ID: ${loan._id}`);
        console.log(`   Estado actual: ${loan.status}`);
        console.log(`   Mora actual: ${loan.lateFee}`);

        // Modificar fechas de vencimiento para que venzan hace 15 días
        const today = new Date();
        const daysAgo = 15;

        console.log(`\n📉 Atrasando fechas ${daysAgo} días...`);

        loan.schedule.forEach((q, idx) => {
            const oldDate = new Date(q.dueDate);
            const newDate = new Date(oldDate);
            newDate.setDate(newDate.getDate() - daysAgo);
            q.dueDate = newDate;
            console.log(`   Cuota #${q.number}: ${oldDate.toISOString().split('T')[0]} -> ${newDate.toISOString().split('T')[0]}`);
        });

        // Resetear status para forzar recálculo
        loan.status = 'active';
        loan.lateFee = 0;

        await loan.save();
        console.log('\n✅ Fechas actualizadas. Recarga la página para ver la mora calculada.');

        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

forceOverdue();
