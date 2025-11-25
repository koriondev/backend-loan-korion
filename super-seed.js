require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Modelos
const Business = require('./models/Business');
const User = require('./models/User');
const Plan = require('./models/Plan');
const Client = require('./models/Client');
const Loan = require('./models/Loan');
const Wallet = require('./models/Wallet');
const Transaction = require('./models/Transaction');
const Settings = require('./models/Settings');
const Product = require('./models/Product');

// Conexión (Usa .env para Atlas)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
  .then(() => initProd())
  .catch(err => console.error('❌ Error conexión:', err));

const initProd = async () => {
  try {
    console.log('🏭 INICIANDO MODO PRODUCCIÓN...');
    console.log('⚠️  BORRANDO DATOS OPERATIVOS...');

    // 1. BORRAR DATOS DE PRUEBA (CLIENTES, PRÉSTAMOS, DINERO)
    await Client.deleteMany({});
    await Loan.deleteMany({});
    await Wallet.deleteMany({});
    await Transaction.deleteMany({});
    await Settings.deleteMany({});
    await Product.deleteMany({});

    // 2. BORRAR EMPRESAS Y USUARIOS VIEJOS
    await Business.deleteMany({});
    await User.deleteMany({});

    console.log('🧹 Base de datos limpia.');

    // 3. CREAR PLANES (NECESARIOS PARA VENDER)
    console.log('📋 Estableciendo Planes Comerciales...');
    // Borramos planes viejos para asegurarnos que estén los oficiales
    await Plan.deleteMany({});

    await Plan.insertMany([
      {
        code: 'free',
        name: 'Gratis (Demo)',
        price: 0,
        limits: { maxLoans: 5, maxUsers: 1, maxRoutes: 0, maxWallets: 1 },
        features: { allowWhatsapp: false, allowMaps: false }
      },
      {
        code: 'basic',
        name: 'Básico (Emprendedor)',
        price: 20,
        limits: { maxLoans: 100, maxUsers: 2, maxRoutes: 2, maxWallets: 2 },
        features: { allowWhatsapp: false, allowMaps: false }
      },
      {
        code: 'pro',
        name: 'Profesional (Pyme)',
        price: 60,
        limits: { maxLoans: 500, maxUsers: 6, maxRoutes: 10, maxWallets: 5 },
        features: { allowWhatsapp: true, allowMaps: true }
      },
      {
        code: 'enterprise',
        name: 'Empresarial (Full)',
        price: 100,
        limits: { maxLoans: 2000, maxUsers: 15, maxRoutes: 99, maxWallets: 20 },
        features: { allowWhatsapp: true, allowMaps: true }
      }
    ]);

    // 4. CREAR SUPER USUARIO TI
    console.log('🦸 Creando Super Admin TI...');
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash('123456', salt); // <--- CONTRASEÑA POR DEFECTO

    await User.create({
      name: 'Soporte TI (Master)',
      email: 'ti@korion.do', // <--- TU CORREO SOLICITADO
      password: hash,
      role: 'ti',
      isActive: true
      // businessId: undefined (El TI es libre)
    });

    console.log('✅ ¡ENTORNO DE PRODUCCIÓN LISTO!');
    console.log('---------------------------------------');
    console.log('🌐 Estado: Limpio (0 Clientes, 0 Deuda)');
    console.log('📋 Planes: Cargados y listos para asignar');
    console.log('🔑 ACCESO MAESTRO:');
    console.log('   User: ti@korion.do');
    console.log('   Pass: 123456');
    console.log('---------------------------------------');
    process.exit();

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};