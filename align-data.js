require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Business = require('./models/Business');
const Client = require('./models/Client');

// Conexión Base de Datos
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('🔧 Alineando datos...');

        // 1. Buscar al usuario que usas (Pedro)
        // Si usas otro email, cámbialo aquí
        const email = 'pedro@demo.com';
        const user = await User.findOne({ email: email });

        if (!user) {
            console.log('❌ Error: El usuario no existe. Ejecuta super-seed.js primero.');
            process.exit();
        }

        // 2. Buscar una empresa válida
        const business = await Business.findOne();
        if (!business) {
            console.log('❌ Error: No hay empresas creadas.');
            process.exit();
        }

        console.log(`🏢 Empresa encontrada: ${business.name} (ID: ${business._id})`);

        // 3. VINCULAR USUARIO A EMPRESA
        user.businessId = business._id;
        await user.save();
        console.log('✅ Usuario vinculado correctamente.');

        // 4. CREAR CLIENTES PARA ESA EMPRESA
        // Primero borramos los viejos para no confundir
        await Client.deleteMany({ businessId: business._id });

        console.log('👥 Creando 5 clientes nuevos para esta empresa...');
        const clientesNuevos = [
            { name: 'Cliente Prueba 1', address: 'Calle A #1', phone: '809-555-0001', occupation: 'Empleado', income: 20000 },
            { name: 'Cliente Prueba 2', address: 'Calle B #2', phone: '809-555-0002', occupation: 'Chiripero', income: 15000 },
            { name: 'Cliente Prueba 3', address: 'Calle C #3', phone: '809-555-0003', occupation: 'Mecánico', income: 30000 },
            { name: 'Cliente Prueba 4', address: 'Calle D #4', phone: '809-555-0004', occupation: 'Abogado', income: 50000 },
            { name: 'Cliente Prueba 5', address: 'Calle E #5', phone: '809-555-0005', occupation: 'Maestra', income: 25000 },
        ];

        for (const c of clientesNuevos) {
            await Client.create({
                ...c,
                businessId: business._id, // <--- LA CLAVE DEL ÉXITO
                status: 'active',
                balance: 0
            });
        }

        console.log('🎉 ¡DATOS ALINEADOS!');
        console.log('------------------------------------------');
        console.log('⚠️  PASO OBLIGATORIO AHORA:');
        console.log('1. Ve a la web.');
        console.log('2. CIERRA SESIÓN (Logout).');
        console.log('3. Vuelve a entrar con: ' + email);
        console.log('------------------------------------------');
        process.exit();
    })
    .catch(console.error);
