require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./models/Product');

// Conexión Base de Datos
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('🌍 Creando Catálogo Global de Productos...');

        // Opcional: Borrar productos anteriores para limpiar
        await Product.deleteMany({});

        const catalog = [
            {
                name: 'Préstamo Personal (Semanal)',
                interestRate: 10, // 10%
                duration: 13,     // 13 Semanas (3 meses)
                frequency: 'weekly',
                interestType: 'simple',
                isGlobal: true
            },
            {
                name: 'Micro-Crédito Diario',
                interestRate: 20,
                duration: 30,     // 30 Días
                frequency: 'daily',
                interestType: 'simple',
                isGlobal: true
            },
            {
                name: 'Préstamo Comercial (Mensual)',
                interestRate: 5,
                duration: 12,     // 12 Meses
                frequency: 'monthly',
                interestType: 'reducing', // Saldo Insoluto
                isGlobal: true
            },
            {
                name: 'Financiamiento Vehículo',
                interestRate: 18, // Anual aprox
                duration: 24,     // 24 Quincenas (1 año)
                frequency: 'biweekly',
                interestType: 'reducing',
                isGlobal: true
            }
        ];

        await Product.insertMany(catalog);

        console.log('✅ 4 Productos Globales creados.');
        console.log('Ahora aparecerán en TODAS las cuentas.');
        process.exit();
    })
    .catch(console.error);