require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const bcrypt = require('bcryptjs');

mongoose.connect('mongodb://localhost:27017/korionloan')
  .then(async () => {
    console.log('🦸‍♂️ Creando Super Usuario TI...');

    try {
      // 1. Verificar si ya existe para no duplicar
      const existing = await User.findOne({ email: 'ti@korion.do' });
      if (existing) {
        console.log('⚠️ El usuario ti@korion.do ya existe. Borrándolo para recrear...');
        await User.deleteOne({ email: 'ti@korion.do' });
      }

      // 2. Encriptar contraseña
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash('123456', salt); // <--- TU CONTRASEÑA

      // 3. Crear el Usuario TI
      const superAdmin = new User({
        name: 'Soporte TI (Master)',
        email: 'ti@korion.do', // <--- AQUI ESTÁ EL .DO
        password: hash,
        role: 'ti', // Rol especial
        isActive: true
        // businessId: null (IMPORTANTE: El TI no tiene negocio, es libre)
      });

      await superAdmin.save();

      console.log('✅ ¡Usuario TI Creado!');
      console.log('--------------------------------');
      console.log('✉️  Email: ti@korion.do');
      console.log('🔑 Pass:  123456');
      console.log('--------------------------------');
      process.exit();

    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  })
  .catch(err => console.error(err));
