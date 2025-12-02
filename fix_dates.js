const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const fixLoanDates = async () => {
    try {
        const user = await User.findOne({ email: 'duartecoronajeffrynoel@gmail.com' });

        // Obtener los 10 préstamos ordenados por creación (que es casi igual para todos)
        // Pero sabemos el orden en que los creamos:
        // 1. Amortizable (Feb)
        // 2. Fixed (Mar)
        // 3. Amortizable (Apr)
        // ...

        const loans = await Loan.find({ businessId: user.businessId }).populate('client');

        if (loans.length === 0) {
            console.log('No hay préstamos para arreglar');
            process.exit(0);
        }

        console.log(`🔧 Arreglando fechas de ${loans.length} préstamos...\n`);

        // Helper para sumar fechas
        const addPeriod = (date, freq) => {
            const newDate = new Date(date);
            if (freq === 'weekly') newDate.setDate(newDate.getDate() + 7);
            else if (freq === 'biweekly') newDate.setDate(newDate.getDate() + 14);
            else if (freq === 'monthly') newDate.setMonth(newDate.getMonth() + 1);
            return newDate;
        };

        // Configuración deseada (Mes de inicio, 0-indexed)
        // El orden de loans.find() puede no ser el de creación, así que usaremos el lendingType y otros datos para identificar,
        // o simplemente asumiremos el orden si los IDs son secuenciales (MongoDB ObjectId tiene timestamp).
        // Mejor: Los ordenamos por _id (timestamp).

        loans.sort((a, b) => a._id.toString().localeCompare(b._id.toString()));

        const startMonths = [
            1, // Feb
            2, // Mar
            3, // Apr
            4, // May
            5, // Jun
            6, // Jul
            7, // Aug
            8, // Sep
            9, // Oct
            10 // Nov
        ];

        for (let i = 0; i < loans.length; i++) {
            const loan = loans[i];
            const targetMonth = startMonths[i] || 10;

            // Nueva fecha de inicio: 1 del mes objetivo de 2025
            const startDate = new Date(2025, targetMonth, 1);

            console.log(`${i + 1}. ${loan.client.name} (${loan.lendingType})`);
            console.log(`   Fecha Inicio Actual: ${new Date(loan.createdAt).toISOString().split('T')[0]}`);
            console.log(`   Nueva Fecha Inicio : ${startDate.toISOString().split('T')[0]}`);

            // Actualizar createdAt
            loan.createdAt = startDate;

            // Recalcular fechas del schedule
            let currentDate = new Date(startDate);

            // La primera cuota vence 1 periodo después del inicio
            currentDate = addPeriod(currentDate, loan.frequency);

            loan.schedule.forEach(q => {
                q.dueDate = new Date(currentDate);
                currentDate = addPeriod(currentDate, loan.frequency);
            });

            // Resetear status y lateFee para que el sistema recalcule
            // Si ya estaba pagado, lo dejamos pagado, pero si estaba active/past_due, lo reseteamos
            if (loan.status !== 'paid') {
                loan.status = 'active';
                loan.lateFee = 0;
            }

            await loan.save();
            console.log(`   ✅ Fechas actualizadas (Vencimiento 1ra cuota: ${loan.schedule[0].dueDate.toISOString().split('T')[0]})\n`);
        }

        console.log('✅ Proceso completado. Recarga la página.');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

fixLoanDates();
