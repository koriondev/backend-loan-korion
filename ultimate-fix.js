require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Esquemas mínimos para que no fallen las dependencias
const businessSchema = new mongoose.Schema({ name: String, ownerEmail: String, planId: mongoose.Schema.Types.ObjectId }, { strict: false });
const userSchema = new mongoose.Schema({ name: String, email: String, role: String, businessId: mongoose.Schema.Types.ObjectId }, { strict: false });
const walletSchema = new mongoose.Schema({ name: String, balance: Number, isDefault: Boolean, businessId: mongoose.Schema.Types.ObjectId }, { strict: false });
const loanSchema = new mongoose.Schema({ amount: Number, balance: Number, status: String, businessId: mongoose.Schema.Types.ObjectId, totalToPay: Number }, { strict: false });
const planSchema = new mongoose.Schema({ code: String, name: String }, { strict: false });

const Business = mongoose.model('Business', businessSchema);
const User = mongoose.model('User', userSchema);
const Wallet = mongoose.model('Wallet', walletSchema);
const Loan = mongoose.model('Loan', loanSchema);
const Plan = mongoose.model('Plan', planSchema);

// Conexión Base de Datos
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('🔥 INICIANDO LIMPIEZA Y REPARACIÓN TOTAL...');

    // 1. BORRAR TODO
    await mongoose.connection.db.dropDatabase();
    console.log('🧹 Base de datos eliminada por completo.');

    // 2. CREAR PLAN
    const plan = await Plan.create({ code: 'pro', name: 'Plan Pro' });

    // 3. CREAR NEGOCIO
    const biz = await Business.create({
      name: 'Financiera REPARADA',
      ownerEmail: 'admin@fix.com',
      planId: plan._id,
      status: 'active'
    });
    console.log(`🏢 Negocio creado: ID ${biz._id}`);

    // 4. CREAR USUARIO
    const hash = await bcrypt.hash('123456', 10);
    const user = await User.create({
      name: 'Admin Fix',
      email: 'admin@fix.com',
      password: hash,
      role: 'admin',
      businessId: biz._id // <--- VINCULACIÓN CRÍTICA
    });
    console.log(`👤 Usuario creado: admin@fix.com (BusinessID: ${user.businessId})`);

    // 5. CREAR CARTERA
    const wallet = await Wallet.create({
      name: 'Caja Principal',
      balance: 500000,
      isDefault: true,
      businessId: biz._id
    });
    console.log(`💰 Cartera creada con RD$ ${wallet.balance}`);

    // 6. CREAR PRÉSTAMO ACTIVO
    await Loan.create({
      amount: 10000,
      balance: 10000,
      totalToPay: 12000,
      status: 'active',
      businessId: biz._id
    });
    console.log('📄 Préstamo de prueba creado (10k).');

    // --- VERIFICACIÓN DE LA VERDAD ---
    console.log('\n🔎 VERIFICANDO DATOS EN DB...');

    const walletCheck = await Wallet.findOne({ businessId: biz._id });
    const loanCheck = await Loan.countDocuments({ businessId: biz._id });

    if (walletCheck && loanCheck > 0) {
      console.log('✅ ÉXITO: La base de datos tiene dinero y préstamos.');
      console.log('-------------------------------------------');
      console.log('👉 USA ESTE USUARIO: admin@fix.com');
      console.log('👉 CONTRASEÑA:       123456');
      console.log('-------------------------------------------');
    } else {
      console.log('❌ ERROR FATAL: Se guardó pero no se encuentra. Algo está muy mal en Mongo.');
    }

    process.exit();
  })
  .catch(e => console.error(e));