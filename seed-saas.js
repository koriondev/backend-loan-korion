require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Importar todos los modelos
const Business = require('./models/Business');
const User = require('./models/User');
const Plan = require('./models/Plan');
const Client = require('./models/Client');
const Loan = require('./models/Loan');
const Wallet = require('./models/Wallet');
const Transaction = require('./models/Transaction');
const Settings = require('./models/Settings');

// Configuración
const MONGO_URI = 'mongodb://localhost:27017/korionloan';

// Conexión
mongoose.connect(MONGO_URI)
  .then(() => runSeed())
  .catch(err => console.error('❌ Error conexión:', err));

const runSeed = async () => {
  try {
    console.log('🔥 BORRANDO TODO (MODO NUCLEAR)...');
    await Promise.all([
      Business.deleteMany({}),
      User.deleteMany({}),
      Plan.deleteMany({}),
      Client.deleteMany({}),
      Loan.deleteMany({}),
      Wallet.deleteMany({}),
      Transaction.deleteMany({}),
      Settings.deleteMany({})
    ]);

    console.log('📋 Creando Planes...');
    const proPlan = await Plan.create({
      code: 'pro', name: 'Plan Profesional', price: 50,
      limits: { maxLoans: 500, maxUsers: 5, maxRoutes: 10, maxWallets: 5 },
      features: { allowWhatsapp: true, allowMaps: true }
    });

    console.log('🏢 Creando Empresa "Inversiones Pedro"...');
    const business = await Business.create({
      name: 'Inversiones Pedro SRL',
      slug: 'inversiones-pedro',
      ownerName: 'Pedro El Grande',
      ownerEmail: 'pedro@demo.com',
      planId: proPlan._id,
      status: 'active',
      licenseExpiresAt: new Date(new Date().setFullYear(new Date().getFullYear() + 1))
    });

    // Crear Configuración por defecto
    await Settings.create({
        companyName: 'Inversiones Pedro SRL',
        currency: 'DOP',
        businessId: business._id // Asumiendo que actualizaste Settings para SaaS, si no, ignora error
    });

    console.log('👤 Creando Usuario Admin...');
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash('123456', salt);
    const user = await User.create({
      name: 'Pedro Admin',
      email: 'pedro@demo.com',
      password: hash,
      role: 'admin',
      businessId: business._id,
      isActive: true
    });

    console.log('💰 Creando Cartera Millonaria...');
    const wallet = await Wallet.create({
      name: 'Caja Fuerte Principal',
      balance: 5000000, // 5 Millones
      isDefault: true,
      businessId: business._id
    });

    console.log('👥 Inyectando 15 Clientes y Préstamos...');
    
    // Generar 15 casos variados
    for (let i = 1; i <= 15; i++) {
      const isLate = i % 3 === 0; // 1 de cada 3 estará en mora
      const isPaid = i > 13; // Los últimos 2 están saldados
      
      // Crear Cliente
      const client = await Client.create({
        name: `Cliente ${isLate ? 'Moroso' : 'Bueno'} ${i}`,
        address: `Calle ${i} #40, Sector Norte`,
        phone: `809-555-${1000 + i}`,
        occupation: isLate ? 'Chiripero' : 'Empleado Privado',
        income: 25000 + (i * 1000),
        status: isPaid ? 'paid' : (isLate ? 'late' : 'active'),
        balance: 0,
        businessId: business._id
      });

      // Si ya pagó, no generamos préstamo activo complejo, solo historial
      if (isPaid) continue;

      // Crear Préstamo
      const amount = 10000 + (i * 2000); // Montos variados
      const duration = 12; // 12 semanas
      const totalPay = amount * 1.15; // 15% interés
      
      // Manipular el tiempo: Préstamo empezó hace 'weeksAgo' semanas
      const weeksAgo = isLate ? 8 : 2; 
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - (weeksAgo * 7));

      // Generar Schedule
      const schedule = [];
      let loanBalance = totalPay;

      for (let j = 1; j <= duration; j++) {
        const dueDate = new Date(startDate);
        dueDate.setDate(dueDate.getDate() + (j * 7));
        
        // Si la fecha ya pasó
        let status = 'pending';
        if (dueDate < new Date()) {
            if (isLate && j > (weeksAgo - 4)) { 
                status = 'pending'; // Dejó de pagar hace 4 semanas
            } else {
                status = 'paid'; // Pagó las primeras
                loanBalance -= (totalPay / duration);
            }
        }

        schedule.push({
          number: j,
          dueDate: dueDate,
          amount: totalPay / duration,
          capital: amount / duration,
          interest: (amount * 0.15) / duration,
          status: status
        });
      }

      await Loan.create({
        client: client._id,
        amount: amount,
        interestRate: 15,
        duration: duration,
        frequency: 'weekly',
        type: 'simple',
        status: 'active',
        totalToPay: totalPay,
        balance: loanBalance,
        schedule: schedule,
        businessId: business._id,
        createdAt: startDate
      });

      // Actualizar saldo cliente
      client.balance = loanBalance;
      await client.save();
      
      // Restar de la cartera (Simulación)
      wallet.balance -= amount;
    }
    
    await wallet.save(); // Guardar balance final cartera

    console.log('✅ ¡TODO LISTO!');
    console.log('---------------------------------------');
    console.log(' 👉 Entra con: pedro@demo.com');
    console.log(' 👉 Clave:     123456');
    console.log('---------------------------------------');
    process.exit();

  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};