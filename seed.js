require('dotenv').config();
const mongoose = require('mongoose');
const Client = require('./models/Client');
const Loan = require('./models/Loan');
const Wallet = require('./models/Wallet');
const Transaction = require('./models/Transaction');

// --- CONFIGURACIÓN ---
const MONGO_URI = 'mongodb://localhost:27017/korionloan';

// --- CONEXIÓN ---
mongoose.connect(MONGO_URI)
  .then(() => console.log('🌱 Iniciando Siembra de Datos Avanzada...'))
  .catch(err => console.error(err));

// --- UTILIDADES DE TIEMPO ---
const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

// --- ESCENARIOS (20 Clientes con Historias Diferentes) ---
const scenarios = [
  // --- GRUPO 1: LOS MOROSOS (ROJO) ---
  { name: 'Luis El Lento', weeksAgo: 10, missed: 10, amount: 20000, note: 'Nunca ha pagado nada' },
  { name: 'Pedro Problema', weeksAgo: 15, missed: 4, amount: 50000, note: 'Pagaba bien, dejó de pagar hace un mes' },
  { name: 'Marta Morosa', weeksAgo: 8, missed: 8, amount: 15000, note: 'No contesta el teléfono' },
  { name: 'Juan Ruina', weeksAgo: 20, missed: 15, amount: 100000, note: 'Caso legal' },
  { name: 'Elena Olvido', weeksAgo: 5, missed: 3, amount: 10000, note: 'Se le olvidaron las ultimas 3' },

  // --- GRUPO 2: ATRASOS LEVES (AMARILLO) ---
  { name: 'Carlos Casi', weeksAgo: 4, missed: 1, amount: 25000, note: 'Se le pasó la de ayer' },
  { name: 'Sofia Semana', weeksAgo: 12, missed: 1, amount: 30000, note: 'Siempre paga un día tarde' },
  { name: 'Miguel Martes', weeksAgo: 6, missed: 1, amount: 8000, note: 'Debe la cuota actual' },
  { name: 'Lucia Lunes', weeksAgo: 2, missed: 1, amount: 5000, note: 'Primer pago fallido' },
  { name: 'Jorge Justo', weeksAgo: 8, missed: 2, amount: 40000, note: 'Debe dos semanas' },

  // --- GRUPO 3: AL DÍA / BUENOS CLIENTES (VERDE) ---
  { name: 'Ana Aprobada', weeksAgo: 10, missed: 0, amount: 100000, note: 'Cliente Estrella' },
  { name: 'Roberto Reloj', weeksAgo: 5, missed: 0, amount: 20000, note: 'Paga puntual' },
  { name: 'Diana Dia', weeksAgo: 1, missed: 0, amount: 15000, note: 'Préstamo Nuevo' },
  { name: 'Fernando Fiel', weeksAgo: 20, missed: 0, amount: 200000, note: 'Lleva medio año pagando bien' },
  { name: 'Patricia Paz', weeksAgo: 3, missed: 0, amount: 10000, note: 'Todo en orden' },
  { name: 'Gabriel Garantia', weeksAgo: 8, missed: 0, amount: 60000, note: 'Excelente pagador' },
  { name: 'Teresa Tiempo', weeksAgo: 12, missed: 0, amount: 35000, note: 'Al día' },

  // --- GRUPO 4: SALDADOS (AZUL) ---
  { name: 'Victor Vencido', weeksAgo: 15, missed: 0, amount: 10000, paidFull: true, note: 'Ya terminó de pagar' },
  { name: 'Sandra Saldada', weeksAgo: 20, missed: 0, amount: 50000, paidFull: true, note: 'Cliente antiguo recuperado' },
  { name: 'Ramon Retiro', weeksAgo: 5, missed: 0, amount: 5000, paidFull: true, note: 'Microcrédito pagado' }
];

const seedDatabase = async () => {
  try {
    // 1. LIMPIEZA TOTAL (Para no duplicar)
    console.log('🧹 Limpiando base de datos...');
    await Client.deleteMany({});
    await Loan.deleteMany({});
    await Wallet.deleteMany({});
    await Transaction.deleteMany({});

    // 2. CREAR CARTERA CON FONDOS
    console.log('💰 Creando Caja Principal...');
    const wallet = new Wallet({
      name: 'Caja General',
      balance: 5000000, // 5 Millones para empezar
      isDefault: true
    });
    await wallet.save();

    console.log(`🚀 Generando ${scenarios.length} Clientes con Historial...`);

    for (const sc of scenarios) {
      // A. Crear Cliente
      const client = new Client({
        name: sc.name,
        address: 'Sector Los Prados, Calle 5 #10',
        phone: '809-555-' + Math.floor(1000 + Math.random() * 9000),
        occupation: 'Comercio',
        income: Math.floor(20000 + Math.random() * 50000),
        status: sc.paidFull ? 'paid' : (sc.missed > 0 ? 'late' : 'active'),
        balance: 0 // Se calculará abajo
      });
      await client.save();

      // Si está saldado, no creamos préstamo activo (o lo creamos cerrado)
      // Para efectos visuales, crearemos el préstamo pero marcaremos todo como pagado
      
      const startDate = addDays(new Date(), -(sc.weeksAgo * 7)); // Fecha inicio en el pasado
      const duration = 24; // Préstamos a 6 meses (24 semanas)
      const rate = 10; // 10% interés
      
      // Cálculo Simple
      const totalPay = sc.amount * (1 + (rate/100));
      const amountPerQuota = totalPay / duration;
      const interestPerQuota = (sc.amount * (rate/100)) / duration;
      const capitalPerQuota = sc.amount / duration;

      let schedule = [];
      let currentBalance = totalPay;

      // GENERAR TABLA EN EL TIEMPO
      for (let i = 1; i <= duration; i++) {
        const dueDate = addDays(startDate, i * 7); // Una cuota cada semana
        const isPast = dueDate < new Date();
        
        let status = 'pending';
        
        // Lógica de la Máquina del Tiempo
        if (sc.paidFull) {
          status = 'paid'; // Todo pagado
        } else if (isPast) {
          // Si la fecha ya pasó, decidimos si pagó o no según el escenario
          // sc.missed = cuántas cuotas recientes NO pagó.
          // Ejemplo: weeksAgo = 10. missed = 2.
          // Significa que las primeras 8 las pagó, las ultimas 2 no.
          
          // Calculamos cuántas cuotas "vencidas" hay en total hasta hoy
          // (Aproximado por la fecha)
          
          const weeksSinceStart = Math.floor((new Date() - startDate) / (1000 * 60 * 60 * 24 * 7));
          
          // Si la cuota 'i' es menor que (semanas transcurridas - las que falló), entonces la pagó.
          if (i <= (weeksSinceStart - sc.missed)) {
            status = 'paid';
          } else {
            status = 'pending'; // Esta se quedó debiendo (Mora)
          }
        }

        if (status === 'paid') {
          currentBalance -= amountPerQuota;
        }

        schedule.push({
          number: i,
          dueDate: dueDate,
          amount: amountPerQuota,
          capital: capitalPerQuota,
          interest: interestPerQuota,
          status: status,
          paidDate: status === 'paid' ? dueDate : null
        });
      }

      // Ajuste de precisión
      if (currentBalance < 0) currentBalance = 0;

      // Guardar Préstamo
      const loan = new Loan({
        client: client._id,
        amount: sc.amount,
        interestRate: rate,
        duration: duration,
        frequency: 'weekly',
        type: 'simple',
        status: sc.paidFull || currentBalance < 1 ? 'paid' : 'active',
        totalToPay: totalPay,
        balance: currentBalance,
        schedule: schedule,
        createdAt: startDate
      });
      await loan.save();

      // Actualizar balance final del cliente
      client.balance = currentBalance;
      await client.save();

      // Simular Salida de dinero de la caja (hace semanas)
      // No restamos de la caja actual para no dejarla en negativo, 
      // pero creamos el registro histórico con fecha vieja.
      const disbursementTx = new Transaction({
        type: 'out_loan',
        amount: sc.amount,
        category: 'Desembolso Histórico',
        description: `Préstamo #${loan._id.toString().slice(-6)}`,
        client: client._id,
        wallet: wallet._id,
        date: startDate
      });
      await disbursementTx.save();
    }

    console.log('\n✅ ¡PRUEBA GENERADA CON ÉXITO!');
    console.log('------------------------------------------------');
    console.log('Analiza el módulo de "ATRASOS" y "REPORTES".');
    console.log('Deberías ver moras reales calculadas por fecha.');
    console.log('------------------------------------------------');
    
    process.exit();

  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

seedDatabase();