require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Business = require('./models/Business');
const bcrypt = require('bcryptjs');

// CONEXIÓN
mongoose.connect('mongodb://localhost:27017/korionloan')
  .then(() => console.log('🔌 Conectado para inicializar SaaS...'))
  .catch(err => console.error(err));

const init = async () => {
  try {
    // 1. LIMPIEZA (Opcional: Borrar todo para empezar limpio)
    console.log('🧹 Limpiando base de datos antigua...');
    // Borramos las colecciones que van a cambiar de estructura
    await User.deleteMany({});
    await Business.deleteMany({});
    // Nota: Clients, Loans, etc. quedarán huérfanos si no los borras también.
    // Recomendado borrar todo en dev:
    const collections = await mongoose.connection.db.collections();
    for (let collection of collections) {
      await collection.deleteMany({});
    }

    // 2. CREAR EL SUPER ADMIN (TI)
    console.log('🦸‍♂️ Creando usuario Super Admin (TI)...');
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash('superadmin123', salt);

    const superAdmin = new User({
      name: 'Soporte TI',
      email: 'ti@korion.com',
      password: hash,
      role: 'ti',
      isActive: true
      // businessId: null (El TI no pertenece a nadie)
    });

    await superAdmin.save();

    console.log('✅ ¡SISTEMA SAAS INICIALIZADO!');
    console.log('-------------------------------------------');
    console.log('Login TI: ti@korion.com / superadmin123');
    console.log('-------------------------------------------');
    process.exit();

  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

init();