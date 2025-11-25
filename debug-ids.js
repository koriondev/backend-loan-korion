require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Client = require('./models/Client');

mongoose.connect('mongodb://localhost:27017/korionloan')
  .then(async () => {
    console.log('-------- REPORTE DE DIAGNÓSTICO --------');
    
    // 1. ¿Quién eres?
    const email = 'admin@fix.com'; // El usuario que usas
    const user = await User.findOne({ email });
    
    if (!user) {
        console.log('❌ EL USUARIO NO EXISTE. Revisa el email.');
        process.exit();
    }
    
    console.log(`👤 Usuario: ${user.name}`);
    console.log(`🔑 Tu BusinessID es:     ${user.businessId}`);

    // 2. ¿Qué clientes hay?
    const anyClient = await Client.findOne();
    if (!anyClient) {
        console.log('❌ NO HAY CLIENTES en la base de datos. Ejecuta un seed.');
        process.exit();
    }

    console.log(`👥 ID de un cliente real: ${anyClient.businessId}`);
    
    // 3. Comparación
    if (user.businessId.toString() === anyClient.businessId.toString()) {
        console.log('✅ ¡LOS IDS COINCIDEN! El problema es el código del Backend.');
    } else {
        console.log('❌ ¡DESASTRE! Los IDs son diferentes. Tu usuario pertenece a una empresa y los clientes a otra.');
    }
    
    // 4. Conteo final
    const count = await Client.countDocuments({ businessId: user.businessId });
    console.log(`📊 El sistema ve ${count} clientes para ti.`);

    process.exit();
  })
  .catch(console.error);
