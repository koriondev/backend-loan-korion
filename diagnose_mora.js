const axios = require('axios');
const mongoose = require('mongoose');
const Client = require('./models/Client');
const Loan = require('./models/Loan');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const inspectLoan = async () => {
    try {
        // Buscar un préstamo que debería estar en mora (ej. el que tiene status 'past_due' o uno creado en Marzo sin pagos)
        // Buscamos el de "Cuota Fija" creado en Marzo (mes 3)

        // Primero listamos todos para identificarlo
        const loans = await Loan.find({}).populate('client');

        console.log(`\n🔍 Inspeccionando ${loans.length} préstamos...\n`);

        const today = new Date();
        const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        console.log(`📅 Fecha del Sistema (Hoy): ${today.toISOString()}`);
        console.log(`📅 Inicio de Hoy (Comparación): ${startOfToday.toISOString()}\n`);

        for (const loan of loans) {
            // Buscamos uno que tenga cuotas pendientes antiguas
            const pendingQuotas = loan.schedule.filter(q => q.status === 'pending');

            if (pendingQuotas.length > 0) {
                const firstPending = pendingQuotas[0];
                const dueDate = new Date(firstPending.dueDate);

                // Si la fecha de vencimiento es anterior a hoy, debería ser mora
                if (dueDate < startOfToday) {
                    console.log(`⚠️  PRÉSTAMO CANDIDATO A MORA ENCONTRADO:`);
                    console.log(`   ID: ${loan._id}`);
                    console.log(`   Cliente: ${loan.client.name}`);
                    console.log(`   Tipo: ${loan.lendingType}`);
                    console.log(`   Estado Actual DB: ${loan.status}`);
                    console.log(`   Mora Actual DB: ${loan.lateFee}`);
                    console.log(`   Primera Cuota Pendiente: #${firstPending.number} vence el ${dueDate.toISOString()}`);
                    console.log(`   ¿Es menor que hoy? ${dueDate < startOfToday}`);

                    console.log(`   Config Mora: ${JSON.stringify(loan.penaltyConfig)}`);

                    // Simular lógica del controlador
                    const overdueCount = loan.schedule.filter(q => q.status === 'pending' && new Date(q.dueDate) < startOfToday).length;
                    console.log(`   Cálculo OverdueCount: ${overdueCount}`);

                    // Ver si hay settings
                    const Settings = require('./models/Settings');
                    const settings = await Settings.findOne({ businessId: loan.businessId });
                    console.log(`   Settings WorkingDays: ${settings ? settings.workingDays : 'No settings (All days working)'}`);

                    console.log('--------------------------------------------------\n');
                }
            }
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

inspectLoan();
