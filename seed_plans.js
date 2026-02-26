const mongoose = require('mongoose');
const Plan = require('./models/Plan');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/korionloan';

const plans = [
    {
        code: 'demo',
        name: 'Plan Demo (Trial)',
        price: 0,
        description: 'Prueba gratuita de 5 días con todas las funciones.',
        limits: {
            maxClients: 5,
            maxLoans: 5,
            maxUsers: 2,
            maxWallets: 1
        },
        modulePermissions: [
            'dashboard', 'wallet', 'history', 'arrears', 'loans',
            'loansv2', 'clients', 'collector', 'routes', 'reports', 'ai'
        ]
    },
    {
        code: 'business',
        name: 'Plan Business (Escalable)',
        price: 30,
        description: 'Ideal para negocios en crecimiento. Módulos a la carta.',
        limits: {
            maxClients: 50,
            maxLoans: 100,
            maxUsers: 5,
            maxWallets: 3
        },
        modulePermissions: [
            'dashboard', 'wallet', 'history', 'arrears', 'loans',
            'clients', 'collector', 'routes'
        ]
    },
    {
        code: 'full',
        name: 'Plan Full (Enterprise)',
        price: 100,
        description: 'Acceso total sin restricciones para grandes financieras.',
        limits: {
            maxClients: 5000,
            maxLoans: 10000,
            maxUsers: 50,
            maxWallets: 20
        },
        modulePermissions: [
            'dashboard', 'wallet', 'history', 'arrears', 'loans',
            'loansv2', 'clients', 'collector', 'routes', 'reports', 'ai'
        ]
    }
];

async function seed() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('🟢 MongoDB Conectado para Seeding');

        for (const planData of plans) {
            await Plan.findOneAndUpdate(
                { code: planData.code },
                planData,
                { upsert: true, new: true }
            );
            console.log(`✅ Plan ${planData.name} inicializado.`);
        }

        console.log('✨ Proceso de seeding completado.');
        process.exit(0);
    } catch (error) {
        console.error('🔴 Error en seeding:', error);
        process.exit(1);
    }
}

seed();
