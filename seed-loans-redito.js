require('dotenv').config();
const mongoose = require('mongoose');
const Client = require('./models/Client');
const Loan = require('./models/Loan');
const Wallet = require('./models/Wallet');
const Transaction = require('./models/Transaction');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

// Helper para fechas
const addDays = (date, days) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
};

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('🌱 Sembrando Préstamos a Rédito (Escenarios Variados)...');

        // 1. Obtener Clientes y Wallet
        const clients = await Client.find({});
        if (clients.length === 0) {
            console.log('❌ No hay clientes. Ejecuta seed-clients.js primero.');
            process.exit();
        }

        const wallet = await Wallet.findOne({ isDefault: true });
        if (!wallet) {
            console.log('❌ No hay caja default.');
            process.exit();
        }

        // 2. Limpiar Préstamos Anteriores (Opcional, pero recomendado para limpieza)
        await Loan.deleteMany({});
        await Transaction.deleteMany({ type: { $in: ['out_loan', 'in_payment'] } });

        // Resetear balances de clientes
        await Client.updateMany({}, { balance: 0, status: 'active' });

        console.log(`📋 Procesando ${clients.length} clientes...`);

        for (let i = 0; i < clients.length; i++) {
            const client = clients[i];
            const isLate = i % 3 === 0; // 1/3 Atrasados
            const isNew = i % 3 === 1;  // 1/3 Nuevos
            const isGood = i % 3 === 2; // 1/3 Al día

            // Configuración del Préstamo
            const amount = 10000 + (i * 5000);
            const rate = 10; // 10% Mensual
            const duration = 12; // 12 Semanas (aunque redito es indefinido, ponemos un "ciclo")
            const frequency = 'weekly';

            // Calcular fechas
            let weeksAgo = 0;
            if (isLate) weeksAgo = 8; // Empezó hace 8 semanas
            if (isGood) weeksAgo = 8; // Empezó hace 8 semanas
            if (isNew) weeksAgo = 0;  // Empieza hoy

            const startDate = addDays(new Date(), -(weeksAgo * 7));

            // Generar Schedule
            const schedule = [];
            const interestAmount = amount * (rate / 100 / 4); // Semanal aprox (10% mensual / 4)

            // Ajuste para que sea redondo (opcional, pero consistente con el sistema)
            const roundToFive = num => Math.round(num / 5) * 5;
            const finalInterest = roundToFive(interestAmount);

            let currentDebt = amount; // En rédito el capital se mantiene hasta el final

            for (let j = 1; j <= duration; j++) {
                const dueDate = addDays(startDate, j * 7);
                let status = 'pending';
                let paidDate = null;
                let paidAmount = 0;

                // Lógica de Pagos Históricos
                if (dueDate < new Date()) {
                    if (isGood) {
                        status = 'paid';
                        paidDate = dueDate;
                        paidAmount = finalInterest;
                    } else if (isLate) {
                        // Pagó las primeras 4, debe las últimas 4
                        if (j <= 4) {
                            status = 'paid';
                            paidDate = dueDate;
                            paidAmount = finalInterest;
                        } else {
                            status = 'pending'; // Mora
                        }
                    }
                }

                schedule.push({
                    number: j,
                    dueDate: dueDate,
                    amount: finalInterest,
                    capital: 0,
                    interest: finalInterest,
                    status: status,
                    paidDate: paidDate,
                    paidAmount: paidAmount,
                    balance_start: amount,
                    balance_after: amount
                });
            }

            // Calcular Estado General
            // En Rédito: Deuda = Capital + Intereses Vencidos
            const pendingInterests = schedule.filter(q => q.status === 'pending' && q.dueDate <= new Date()).reduce((acc, q) => acc + q.interest, 0);
            const totalDebt = amount + pendingInterests;

            const loanStatus = (totalDebt > amount) ? 'active' : 'active'; // Siempre activo en redito hasta cancelar capital

            const loan = new Loan({
                client: client._id,
                businessId: client.businessId,
                amount: amount,
                interestRate: rate,
                duration: duration,
                frequency: frequency,
                type: 'redito', // <--- IMPORTANTE
                lendingType: 'redito',
                status: loanStatus,
                totalToPay: amount + (finalInterest * duration), // Referencial
                balance: totalDebt, // Balance actual real
                currentCapital: amount, // <--- REQUIRED
                schedule: schedule,
                createdAt: startDate
            });

            await loan.save();

            // Actualizar Cliente
            client.balance = totalDebt;
            client.status = (pendingInterests > 0) ? 'late' : 'active';
            await client.save();

            // Transacción de Desembolso
            await Transaction.create({
                type: 'out_loan',
                amount: amount,
                category: 'Desembolso',
                description: `Préstamo #${loan._id.toString().slice(-6)}`,
                client: client._id,
                wallet: wallet._id,
                businessId: client.businessId,
                date: startDate
            });

            console.log(`✅ ${client.name}: ${isLate ? '🔴 Atrasado' : (isGood ? '🟢 Al día' : '🔵 Nuevo')} - Deuda: ${totalDebt}`);
        }

        console.log('✨ Semilla completada.');
        process.exit();
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
