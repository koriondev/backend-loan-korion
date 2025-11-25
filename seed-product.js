require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./models/Product');
const User = require('./models/User'); // <--- Necesitamos buscar al usuario

// TU EMAIL
const MY_EMAIL = 'admin@korion.do';

mongoose.connect('mongodb://localhost:27017/korionloan').then(async () => {
    
    // 1. Buscar tu usuario para obtener tu ID de empresa real
    const user = await User.findOne({ email: MY_EMAIL });
    
    if (!user || !user.businessId) {
        console.log(`❌ El usuario ${MY_EMAIL} no existe o no tiene empresa.`);
        process.exit();
    }

    console.log(`🏢 Creando producto para la empresa: ${user.businessId}`);

    // 2. Crear el Producto vinculado a TU empresa
    await Product.create({
        name: 'Préstamo Reditos (Saldo Insoluto)',
        businessId: user.businessId, // <--- AQUÍ ESTÁ LA CLAVE
        interestRate: 10, 
        duration: 13, 
        frequency: 'weekly',
        interestType: 'reducing'
    });
    
    console.log('✅ Producto creado exitosamente. Recarga la página de Préstamos.');
    process.exit();
});