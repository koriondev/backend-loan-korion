const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const updateLoans = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });
        const allLoans = await Loan.find({ businessId: user.businessId });

        // Lista de IDs a actualizar (incluyendo el corregido 1d4cdf)
        const targetIds = ['1d721b', '1d4cdf', '1d4590', '1d4abd', '1d4833'];

        console.log('Actualizando préstamos a fechas 1 y 16...');

        for (const shortId of targetIds) {
            const loan = allLoans.find(l => l._id.toString().toLowerCase().endsWith(shortId.toLowerCase()));

            if (loan) {
                console.log(`\nProcesando: ${loan._id} (${shortId})`);

                // Determinar fecha base para la primera cuota PENDIENTE
                // Si hay cuotas pagadas, respetamos sus fechas o las dejamos como están?
                // El usuario quiere que "no generen mora incorrecta", así que debemos ajustar las pendientes.

                // Lógica:
                // Recorrer el schedule.
                // Si está pagada, dejarla (o ajustarla si es necesario para historial, pero mejor no tocar lo pagado para no romper recibos).
                // Si está pendiente, ajustar a 1 o 16.

                // Encontrar la primera cuota pendiente para establecer el ciclo
                const firstPendingIndex = loan.schedule.findIndex(q => q.status === 'pending' || q.status === 'partial');

                if (firstPendingIndex === -1) {
                    console.log('  ⚠️ No hay cuotas pendientes.');
                    continue;
                }

                // Definir fecha de inicio para el recálculo desde la primera pendiente
                // Usaremos el mes/año de la fecha original de esa cuota para decidir si es 1 o 16

                let currentMonth = new Date(loan.schedule[firstPendingIndex].dueDate).getMonth();
                let currentYear = new Date(loan.schedule[firstPendingIndex].dueDate).getFullYear();

                // Decidir si empezamos en 1 o 16 basado en la fecha original
                // Si era <= 10, movemos al 1. Si era > 10, movemos al 16.
                let originalDay = new Date(loan.schedule[firstPendingIndex].dueDate).getDate();
                let nextDay = originalDay <= 10 ? 1 : 16;

                // Ajustar año/mes si es necesario (ej. si era 28 y movemos a 1 del siguiente, o si era 12 y movemos a 16)
                // Simplificación: Forzamos a 1 o 16 del MISMO mes/año original, a menos que sea muy tarde.
                // Mejor enfoque: Iterar secuencialmente desde la primera pendiente.

                // Vamos a reconstruir las fechas secuencialmente desde la primera pendiente
                let processDate = new Date(currentYear, currentMonth, nextDay);

                for (let i = firstPendingIndex; i < loan.schedule.length; i++) {
                    const quota = loan.schedule[i];

                    // Establecer nueva fecha
                    quota.dueDate = new Date(processDate);

                    console.log(`  Cuota #${quota.number}: ${quota.dueDate.toLocaleDateString()}`);

                    // Calcular siguiente fecha (1 -> 16 -> 1 next month)
                    if (processDate.getDate() === 1) {
                        processDate.setDate(16);
                    } else {
                        // Es 16, mover al 1 del siguiente mes
                        processDate = new Date(processDate.getFullYear(), processDate.getMonth() + 1, 1);
                    }
                }

                loan.markModified('schedule');
                await loan.save();
                console.log('  ✅ Guardado.');

            } else {
                console.log(`\n❌ NO Encontrado: ${shortId}`);
            }
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

updateLoans();
