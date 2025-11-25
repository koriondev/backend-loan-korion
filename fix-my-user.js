require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Business = require('./models/Business');

const TARGET_EMAIL = 'admin@fix.com'; // <--- TU EMAIL AQUÍ

// Conexión Base de Datos
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log(`🔧 Reparando usuario: ${TARGET_EMAIL}`);

    const user = await User.findOne({ email: TARGET_EMAIL });
    if (!user) {
      console.log('❌ Usuario no encontrado');
      process.exit();
    }

    // Buscar cualquier negocio disponible
    const biz = await Business.findOne();
    if (!biz) {
      console.log('❌ No hay negocios creados. Ejecuta seed-saas.js');
      process.exit();
    }

    console.log(`🏢 Asignando a empresa: ${biz.name} (${biz._id})`);

    // FORZAR ASIGNACIÓN
    user.businessId = biz._id;
    await user.save();

    console.log('✅ Usuario reparado. Cierra sesión y vuelve a entrar.');
    process.exit();
  })
  .catch(console.error);