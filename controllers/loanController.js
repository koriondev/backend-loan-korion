const mongoose = require('mongoose');
const Loan = require('../models/Loan');
const Client = require('../models/Client');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const Settings = require('../models/Settings');
const Product = require('../models/Product');
const notificationController = require('./notificationController');
const { generateReceiptPDF } = require('../utils/pdfGenerator');

// Función auxiliar fechas
const getNextDate = (startDate, index, freq, settings, paymentDaysMode) => {
  let date = new Date(startDate);

  if (freq === 'biweekly' && paymentDaysMode === '15_30') {
    // Lógica para días 15 y 30 (o fin de mes)
    for (let i = 0; i < index; i++) {
      const day = date.getDate();
      const year = date.getFullYear();
      const month = date.getMonth();
      const lastDayOfMonth = new Date(year, month + 1, 0).getDate();

      if (day < 15) {
        // Si es antes del 15, el siguiente pago es el 15
        date = new Date(year, month, 15);
      } else if (day < lastDayOfMonth) {
        // Si es entre 15 y fin de mes, el siguiente pago es fin de mes
        date = new Date(year, month + 1, 0);
      } else {
        // Si es fin de mes, el siguiente pago es el 15 del próximo mes
        date = new Date(year, month + 1, 15);
      }
    }
  } else {
    // Lógica estándar
    const daysMap = { 'daily': 1, 'weekly': 7, 'biweekly': 15, 'monthly': 30 };
    const daysToAdd = daysMap[freq] || 7;
    date.setDate(date.getDate() + (index * daysToAdd));
  }

  // Ajustar si es día no laborable (si hay settings)
  if (settings && settings.workingDays && settings.workingDays.length > 0) {
    const isWorkingDay = (d) => {
      const dayOfWeek = d.getDay(); // 0-6
      const isDayOff = !settings.workingDays.includes(dayOfWeek);

      // Verificar feriados específicos
      const isHoliday = settings.nonWorkingDates && settings.nonWorkingDates.some(holiday => {
        const h = new Date(holiday);
        return h.getDate() === d.getDate() && h.getMonth() === d.getMonth() && h.getFullYear() === d.getFullYear();
      });

      return !isDayOff && !isHoliday;
    };

    // Si cae en día no laborable, mover al siguiente día hasta encontrar uno laborable
    while (!isWorkingDay(date)) {
      date.setDate(date.getDate() + 1);
    }
  }

  return date;
};

// Función auxiliar: Calcular Tasa del Periodo basada en Tasa Mensual
const getPeriodicRate = (monthlyRatePercent, frequency) => {
  const rateDecimal = Number(monthlyRatePercent) / 100;
  let divisor = 1;

  if (frequency === 'daily') divisor = 30;
  if (frequency === 'weekly') divisor = 4;
  if (frequency === 'biweekly') divisor = 2;
  if (frequency === 'monthly') divisor = 1;

  return rateDecimal / divisor;
};

// Función auxiliar: Calcular Esquema de Pagos
const calculateSchedule = (amount, rate, term, frequency, type, settings, startDate = new Date(), paymentDaysMode = 'standard') => {
  const finalRate = Number(rate) || 0;
  const finalFreq = frequency || 'weekly';
  const finalType = type || 'simple';
  const finalTerm = Number(term) || 12;
  const finalAmount = Number(amount);
  const start = new Date(startDate);

  const periodicRate = getPeriodicRate(finalRate, finalFreq);
  const roundToNearestFive = (num) => Math.round(num / 5) * 5;

  let schedule = [];
  let totalToPay = 0;

  if (finalType === 'redito') {
    const interestAmount = roundToNearestFive(finalAmount * periodicRate);
    for (let i = 1; i <= finalTerm; i++) {
      schedule.push({
        number: i,
        dueDate: getNextDate(start, i, finalFreq, settings, paymentDaysMode),
        amount: interestAmount,
        capital: 0,
        interest: interestAmount,
        status: 'pending',
        balance_start: finalAmount,
        balance_after: finalAmount // En rédito el capital no baja
      });
    }
    totalToPay = (interestAmount * finalTerm) + finalAmount;

  } else if (finalType === 'reducing' || finalType === 'amortization') {
    let paymentTheoretical = 0;
    if (periodicRate === 0) paymentTheoretical = finalAmount / finalTerm;
    else paymentTheoretical = finalAmount * (periodicRate * Math.pow(1 + periodicRate, finalTerm)) / (Math.pow(1 + periodicRate, finalTerm) - 1);

    const paymentAmount = roundToNearestFive(paymentTheoretical);
    let currentBalance = finalAmount;

    for (let i = 1; i <= finalTerm; i++) {
      const interestPart = currentBalance * periodicRate;
      const capitalPart = paymentAmount - interestPart;
      currentBalance -= capitalPart;

      schedule.push({
        number: i,
        dueDate: getNextDate(start, i, finalFreq, settings, paymentDaysMode),
        amount: paymentAmount,
        capital: capitalPart,
        interest: interestPart,
        status: 'pending',
        balance_after: Math.max(0, currentBalance)
      });
    }
    totalToPay = schedule.reduce((acc, q) => acc + q.amount, 0);

  } else { // Fixed / Simple
    const interestTotalTheoretical = finalAmount * periodicRate * finalTerm;
    const totalToPayTheoretical = finalAmount + interestTotalTheoretical;
    const paymentTheoretical = totalToPayTheoretical / finalTerm;
    const paymentAmount = roundToNearestFive(paymentTheoretical);

    const totalToPayReal = paymentAmount * finalTerm;
    const interestTotalReal = totalToPayReal - finalAmount;
    const capitalPart = finalAmount / finalTerm;
    const interestPart = interestTotalReal / finalTerm;

    // En Fixed, el balance suele verse como Deuda Total Restante
    let currentTotalDebt = totalToPayReal;

    for (let i = 1; i <= finalTerm; i++) {
      currentTotalDebt -= paymentAmount;
      schedule.push({
        number: i,
        dueDate: getNextDate(start, i, finalFreq, settings, paymentDaysMode),
        amount: paymentAmount,
        capital: capitalPart,
        interest: interestPart,
        status: 'pending',
        balance_after: Math.max(0, currentTotalDebt)
      });
    }
    totalToPay = totalToPayReal;
  }

  return { schedule, totalToPay, finalRate, finalFreq, finalType, finalTerm, finalAmount };
};

// HELPER: Check if a date is a working day
const isWorkingDay = (date, settings) => {
  if (!settings || !settings.workingDays) return true; // Si no hay config, todo es laborable

  const dayOfWeek = date.getDay(); // 0-6 (0=Sunday, 6=Saturday)

  // Check if day is in working days
  if (!settings.workingDays.includes(dayOfWeek)) return false;

  // Check if date is a holiday
  if (settings.nonWorkingDates && settings.nonWorkingDates.length > 0) {
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    const isHoliday = settings.nonWorkingDates.some(holiday => {
      const holidayStr = new Date(holiday).toISOString().split('T')[0];
      return holidayStr === dateStr;
    });
    if (isHoliday) return false;
  }

  return true;
};

// HELPER: Calcular Mora Acumulativa (CORREGIDO CON GRACE PERIOD)
const calculateLateFee = (loan, overdueInstallmentsCount, settings) => {
  if (!loan.penaltyConfig || overdueInstallmentsCount <= 0) return 0;

  const { type, value, gracePeriod = 0 } = loan.penaltyConfig;

  // CRITICAL FIX: Use start of today (00:00) instead of current time
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Helper to check if date is working day
  const isWorkingDay = (date) => {
    if (!settings) return true; // Si no hay settings, todos los días cuentan

    const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday

    // Check if it's a working day (not in non-working days list)
    if (settings.workingDays && !settings.workingDays.includes(dayOfWeek)) {
      return false;
    }

    // Check if it's a holiday
    if (settings.nonWorkingDates && settings.nonWorkingDates.length > 0) {
      const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
      if (settings.nonWorkingDates.includes(dateStr)) {
        return false;
      }
    }

    return true;
  };

  // Calculate grace deadline: dueDate + gracePeriod WORKING days
  const calculateGraceDeadline = (dueDate, graceDays) => {
    if (graceDays <= 0) return new Date(dueDate);

    let deadline = new Date(dueDate);
    let addedDays = 0;

    // Add working days for grace period
    while (addedDays < graceDays) {
      deadline.setDate(deadline.getDate() + 1);
      if (isWorkingDay(deadline)) {
        addedDays++;
      }
    }

    // After adding grace period working days, if we land on a non-working day,
    // move to the next working day
    while (!isWorkingDay(deadline)) {
      deadline.setDate(deadline.getDate() + 1);
    }

    return deadline;
  };

  // Get the oldest overdue installment
  const overdueQuotas = loan.schedule.filter(q => {
    if (q.status !== 'pending') return false;
    const dueDate = new Date(q.dueDate);
    return dueDate < startOfToday;
  });

  if (overdueQuotas.length === 0) return 0;

  const oldestOverdue = overdueQuotas[0];
  const originalDueDate = new Date(oldestOverdue.dueDate);

  // Calculate grace deadline
  const graceDeadline = calculateGraceDeadline(originalDueDate, gracePeriod);

  // If today is still before or equal to grace deadline, NO LATE FEE
  if (startOfToday <= graceDeadline) {
    return 0;
  }

  // Count WORKING days overdue AFTER grace deadline
  let currentDate = new Date(graceDeadline);
  currentDate.setDate(currentDate.getDate() + 1); // Start from day after grace deadline

  let workingDaysOverdue = 0;
  while (currentDate < startOfToday) {
    if (isWorkingDay(currentDate)) {
      workingDaysOverdue++;
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Calculate late fee based on type
  if (type === 'percent') {
    const quotaAmount = oldestOverdue.amount || 0;
    return (quotaAmount * value / 100) * workingDaysOverdue;
  } else if (type === 'fixed') {
    return value * workingDaysOverdue;
  }

  return 0;
};

// 0. PREVISUALIZAR PRÉSTAMO
exports.previewLoan = async (req, res) => {
  try {
    const { amount, interestRate, duration, frequency, type, lendingType, startDate } = req.body;
    console.log('=== PREVIEW LOAN DEBUG ===');
    console.log('StartDate received:', startDate);

    // Obtener settings para días laborables
    // Nota: req.user puede no estar disponible si es público, pero asumimos authMiddleware
    let settings = null;
    if (req.user && req.user.businessId) {
      settings = await Settings.findOne({ businessId: req.user.businessId });
    }

    const result = calculateSchedule(amount, interestRate, duration, frequency, lendingType || type, settings, startDate);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 1. CREAR PRÉSTAMO
exports.createLoan = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { clientId, productId, amount, interestRate, duration, frequency, type, lendingType } = req.body;

    console.log('=== CREATE LOAN DEBUG ===');
    console.log('Body:', JSON.stringify(req.body, null, 2));

    // A. Definir Reglas
    let calcParams = { amount, rate: interestRate, term: duration, freq: frequency, type: lendingType || type };
    let finalPenaltyConfig = req.body.penaltyConfig; // Default from request

    if (productId) {
      const product = await Product.findById(productId).session(session);
      if (product) {
        calcParams.rate = product.interestRate;
        calcParams.freq = product.frequency;
        calcParams.type = product.interestType;
        calcParams.term = product.duration || duration;
        // Si hay producto, este define la mora
        finalPenaltyConfig = product.penaltyConfig;
      }
    }

    // Obtener Settings (Globales)
    const settings = await Settings.findOne({ businessId: req.user.businessId }).session(session);

    // Si no hay config, usar defaults globales (Settings)
    if (!finalPenaltyConfig) {
      if (settings) {
        finalPenaltyConfig = {
          type: settings.lateFeeType,
          value: settings.lateFeeValue,
          gracePeriod: settings.gracePeriod
        };
      }
    }

    // B. MOTOR MATEMÁTICO
    // MIGRACIÓN: Obtener fecha inicio
    const { startDate: customStartDate, paymentDaysMode } = req.body;
    const loanStartDate = customStartDate ? new Date(customStartDate) : new Date();

    const { schedule, totalToPay, finalRate, finalFreq, finalType, finalTerm, finalAmount } = calculateSchedule(
      calcParams.amount,
      calcParams.rate,
      calcParams.term,
      calcParams.freq,
      calcParams.type,
      settings,
      loanStartDate,
      paymentDaysMode // Nuevo parámetro
    );

    // Validar Caja
    let wallet = await Wallet.findOne({ isDefault: true, businessId: req.user.businessId }).session(session);
    if (!wallet) wallet = await Wallet.findOne({ businessId: req.user.businessId }).session(session);

    if (!wallet || wallet.balance < finalAmount) throw new Error("Fondos insuficientes en caja.");

    const newLoan = new Loan({
      client: clientId,
      businessId: req.user.businessId,
      amount: finalAmount,
      currentCapital: finalAmount,
      interestRate: finalRate,
      duration: finalTerm,
      frequency: finalFreq,
      type: finalType,
      lendingType: finalType,
      status: 'active',
      totalToPay: totalToPay,
      balance: totalToPay, // Balance inicial = Total a Pagar (o Capital si es rédito, ajustado luego)
      currentCapital: finalAmount, // Base de cálculo
      schedule: schedule,
      penaltyConfig: finalPenaltyConfig, // <--- GUARDAR CONFIG
      createdAt: new Date()
    });

    // Ajuste específico para Rédito: Balance = Capital (Interés se genera con el tiempo)
    if (finalType === 'redito') {
      newLoan.balance = finalAmount;
    }

    // MIGRACIÓN: Marcar cuotas como pagadas si se especificó
    const { paidInstallments } = req.body;
    // loanStartDate ya fue calculado arriba

    if (paidInstallments && paidInstallments > 0) {
      let totalPaidAmount = 0;
      let paidCapital = 0;
      let paidInterest = 0;

      // Marcar las primeras N cuotas como pagadas
      for (let i = 0; i < Math.min(paidInstallments, newLoan.schedule.length); i++) {
        const installment = newLoan.schedule[i];
        installment.status = 'paid';
        installment.paidDate = new Date(installment.dueDate); // Usar fecha de vencimiento como fecha de pago
        installment.paidAmount = installment.amount;
        installment.paidInterest = installment.interest || 0;
        installment.paidCapital = installment.capital || 0;

        totalPaidAmount += installment.amount;
        paidInterest += installment.interest || 0;
        paidCapital += installment.capital || 0;
      }

      // Ajustar balance del préstamo
      if (finalType === 'redito') {
        // En Rédito, el balance es el capital (no cambia con pagos de interés)
        newLoan.balance = finalAmount;
      } else {
        // En otros tipos, restar el capital pagado
        newLoan.balance -= paidCapital;
      }

      // Actualizar el balance del cliente (solo lo que falta por pagar)
      await Client.findByIdAndUpdate(clientId, {
        status: 'active',
        $inc: { balance: newLoan.balance }
      }).session(session);
    } else {
      // Sin migración, balance normal
      await Client.findByIdAndUpdate(clientId, {
        status: 'active',
        $inc: { balance: totalToPay }
      }).session(session);
    }

    // Usar fecha personalizada si se especificó
    newLoan.createdAt = loanStartDate;

    // FIX: Verificar si ya nace vencido (para préstamos migrados/históricos)
    if (newLoan.status !== 'paid') {
      const today = new Date();
      const hasOverdue = newLoan.schedule.some(q => q.status === 'pending' && new Date(q.dueDate) < today);
      if (hasOverdue) {
        newLoan.status = 'past_due';
      }
    }

    await newLoan.save({ session });

    wallet.balance -= finalAmount;
    await wallet.save({ session });

    const tx = new Transaction({
      type: 'out_loan',
      amount: finalAmount,
      category: 'Desembolso',
      description: `Préstamo #${newLoan._id.toString().slice(-6)} (${finalType})${paidInstallments ? ' - Migrado' : ''}`,
      client: clientId,
      wallet: wallet._id,
      businessId: req.user.businessId,
      date: loanStartDate // Usar fecha personalizada
    });
    await tx.save({ session });

    await session.commitTransaction();

    // NOTIFICACIÓN: Préstamo Aprobado
    try {
      await notificationController.createNotification(
        req.user.businessId,
        'loan_approved',
        `Préstamo aprobado para ${clientId} por $${finalAmount}`,
        newLoan._id
      );
    } catch (notifError) {
      console.error('Error creando notificación de préstamo:', notifError);
    }

    res.status(201).json(newLoan);

  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ error: error.message });
  } finally {
    session.endSession();
  }
};

// 2. OBTENER PRÉSTAMOS
// 2. OBTENER PRÉSTAMOS
exports.getLoans = async (req, res) => {
  try {
    const filter = req.businessFilter || { businessId: req.user.businessId };
    const loans = await Loan.find(filter).populate('client', 'name').sort({ createdAt: -1 });

    // Fetch settings for late fee calculation
    const settings = await Settings.findOne({ businessId: req.user.businessId });

    // FIX: Actualizar estados de atraso automáticamente Y verificar si está pagado
    const today = new Date();
    const updatedLoans = await Promise.all(loans.map(async (loan) => {
      let newStatus = loan.status;

      // 1. Check if Paid (Self-healing)
      if (loan.balance <= 0.1 && loan.status !== 'paid') {
        newStatus = 'paid';
      }
      // 2. Check Overdue (Only if not paid)
      else if (newStatus !== 'paid' && newStatus !== 'bad_debt') {
        const hasOverdue = loan.schedule.some(q => q.status === 'pending' && new Date(q.dueDate) < today);
        if (hasOverdue && newStatus !== 'past_due') {
          newStatus = 'past_due';
        } else if (!hasOverdue && newStatus === 'past_due') {
          newStatus = 'active';
        }
      }

      if (newStatus !== loan.status) {
        loan.status = newStatus;
        await loan.save();
      }

      // CALCULAR MORA ACTUAL PARA ENVIAR AL FRONTEND
      const overdueCount = loan.schedule.filter(q => q.status === 'pending' && new Date(q.dueDate) < today).length;
      const calculatedLateFee = calculateLateFee(loan, overdueCount, settings);
      const paidLateFee = loan.paidLateFee || 0;
      const lateFee = Math.max(0, calculatedLateFee - paidLateFee);

      return {
        ...loan.toObject(),
        lateFee: lateFee || 0
      };
    }));

    res.json(updatedLoans);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 3. REGISTRAR PAGO
exports.registerPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { loanId, amount, paymentType, walletId } = req.body; // paymentType: 'quota' | 'capital'

    console.log('=== REGISTRAR PAGO DEBUG ===');
    console.log('loanId recibido:', loanId);
    console.log('amount:', amount);
    console.log('walletId:', walletId);

    const loan = await Loan.findById(loanId).session(session);
    console.log('Préstamo encontrado:', loan ? 'SÍ' : 'NO');
    if (!loan) throw new Error("Préstamo no encontrado");

    // Obtener clientId del préstamo
    const clientId = loan.client;
    const client = await Client.findById(clientId).session(session);
    const wallet = await Wallet.findById(walletId).session(session);
    if (!wallet) throw new Error("Caja no encontrada");

    // Validaciones básicas
    // Validaciones básicas
    if (amount <= 0) throw new Error("Monto inválido");

    // Recalcular mora actual para validación
    const today = new Date();
    const overdueInstallments = loan.schedule.filter(q => q.status === 'pending' && new Date(q.dueDate) <= today).length;
    const totalCalculatedLateFee = calculateLateFee(loan, overdueInstallments);

    // FIX: Restar lo que ya se ha pagado de mora
    const paidLateFee = loan.paidLateFee || 0;
    const totalLateFee = Math.max(0, totalCalculatedLateFee - paidLateFee);

    // Calcular deuda total real para validación
    let totalRealDebt = loan.balance + totalLateFee;

    // Para Rédito, el balance es solo capital, hay que sumar intereses vencidos Y el actual si se va a saldar
    if (loan.lendingType === 'redito') {
      const pendingInterest = loan.schedule
        .filter(q => q.status === 'pending' && new Date(q.dueDate) <= today)
        .reduce((acc, q) => acc + (q.interest || 0) - (q.paidInterest || 0), 0);

      totalRealDebt += pendingInterest;

      // Sumar también el interés de la próxima cuota (actual) si existe, ya que el usuario podría querer saldar
      const nextQuota = loan.schedule.find(q => q.status === 'pending' && new Date(q.dueDate) > today);
      if (nextQuota) {
        totalRealDebt += (nextQuota.interest || 0) - (nextQuota.paidInterest || 0);
      }
    }

    if (amount > totalRealDebt + 100000) throw new Error("Monto excede deuda total por mucho (verifique monto)");

    // 3. Lógica de Distribución del Pago
    // Orden de prelación: Mora -> Interés -> Capital

    // (Mora ya calculada arriba)

    let remainingPayment = amount;
    let appliedToMora = 0;
    let appliedToInterest = 0;
    let appliedToCapital = 0;

    // A. Cobrar Mora
    if (totalLateFee > 0) {
      const moraToPay = Math.min(remainingPayment, totalLateFee);
      appliedToMora = moraToPay;
      remainingPayment -= moraToPay;

      // Actualizar mora pagada en el préstamo
      loan.paidLateFee = (loan.paidLateFee || 0) + appliedToMora;
    }

    // B. Cobrar Intereses y Capital (Iterando cuotas)
    let currentPayment = remainingPayment;
    let paidFutureQuota = false; // Flag para controlar pago de cuotas futuras en Rédito

    for (let i = 0; i < loan.schedule.length; i++) {
      if (currentPayment <= 0) break;
      let q = loan.schedule[i];

      if (q.status === 'pending' || q.status === 'partial') {
        // FIX: En Rédito, si la cuota es futura y ya pagamos la actual (o no hay vencidas), NO seguir pagando intereses futuros.
        // Priorizar Capital.
        if (loan.lendingType === 'redito') {
          const isFuture = new Date(q.dueDate) > new Date();
          if (isFuture) {
            if (paidFutureQuota) {
              // Ya pagamos una cuota futura (la actual), el resto va a capital.
              break;
            }
            paidFutureQuota = true; // Marcamos que estamos pagando la cuota actual/futura inmediata
          }
        }

        // 1. Interés
        const interestPending = (q.interest || 0) - (q.paidInterest || 0);
        if (interestPending > 0) {
          const payInt = Math.min(currentPayment, interestPending);
          q.paidInterest = (q.paidInterest || 0) + payInt;
          appliedToInterest += payInt;
          currentPayment -= payInt;
        }

        // 2. Capital
        let capitalPending = (q.capital || 0) - (q.paidCapital || 0);

        // FIX: En Rédito, las cuotas tienen capital 0, pero si sobra dinero se debe abonar al capital principal
        if (loan.lendingType === 'redito' && currentPayment > 0 && interestPending <= 0) {
          // En rédito, el capital está en el préstamo global, no en cuotas específicas (salvo la última teóricamente, pero aquí lo manejamos flexible)
          // Permitimos abonar todo lo que sobre a capital
          capitalPending = currentPayment;
        }

        if (capitalPending > 0 && currentPayment > 0) {
          const payCap = Math.min(currentPayment, capitalPending);
          q.paidCapital = (q.paidCapital || 0) + payCap;
          appliedToCapital += payCap;
          currentPayment -= payCap;
        }

        // Actualizar estado de cuota
        q.paidAmount = (q.paidInterest || 0) + (q.paidCapital || 0);

        // En Rédito, una cuota se paga si se cubre el interés. El capital es aparte.
        if (loan.lendingType === 'redito') {
          if (q.paidInterest >= (q.interest - 0.1)) {
            q.status = 'paid';
            q.paidDate = new Date();
          } else if (q.paidInterest > 0) {
            q.status = 'partial';
          }
        } else {
          if (q.paidInterest >= (q.interest - 0.1) && q.paidCapital >= (q.capital - 0.1)) {
            q.status = 'paid';
            q.paidDate = new Date();
          } else if (q.paidAmount > 0) {
            q.status = 'partial';
          }
        }
      }
    }

    // Si es Rédito y sobró dinero (porque se acabaron las cuotas vencidas/pendientes), aplicar al capital general
    if (loan.lendingType === 'redito' && currentPayment > 0) {
      appliedToCapital += currentPayment;
      // No lo asignamos a una cuota específica del schedule visual, o podríamos asignarlo a la última.
      // Por ahora solo reducimos el balance.
      currentPayment = 0;
    }

    // C. Actualizar Totales del Préstamo
    // FIX: Para préstamos que no son rédito (Fixed/Amortization), el balance incluye intereses, así que debemos restar también lo pagado de interés.
    if (loan.lendingType === 'redito') {
      loan.balance -= appliedToCapital;
    } else {
      loan.balance -= (appliedToCapital + appliedToInterest);
    }

    // Si el balance es <= 0, marcar como pagado
    if (loan.balance <= 0.1) { // Margen por decimales
      loan.status = 'paid';
      loan.balance = 0; // Evitar negativos feos si es muy pequeño
      // Opcional: Marcar cuotas pendientes como canceladas o pagadas?
      // Por ahora lo dejamos así, el status del préstamo manda.
    }

    // Guardar
    loan.markModified('schedule');
    await loan.save({ session });

    // Actualizar Cliente y Caja
    client.balance = loan.balance; // Esto podría estar mal si el cliente tiene OTROS préstamos. 
    // FIX: El balance del cliente debe ser la suma de sus préstamos o ajustarse por delta.
    // El código original hacía: client.balance = loan.balance; 
    // Esto asume que el cliente SOLO tiene este préstamo o que client.balance trackea SOLO este préstamo?
    // Revisando createLoan: $inc: { balance: totalToPay }.
    // Entonces client.balance es la deuda TOTAL del cliente.
    // Aquí estamos SOBREESCRIBIENDO el balance del cliente con el balance de ESTE préstamo.
    // ESTO ES UN BUG POTENCIAL si el cliente tiene múltiples préstamos.
    // Deberíamos hacer $inc: { balance: -amount } (o lo que se pagó de capital/interés?)
    // Pero el código original hacía `client.balance = loan.balance`.
    // Vamos a corregirlo para que sea seguro: restar lo pagado al balance del cliente.

    // Recuperamos el cliente de nuevo para asegurar
    // client.balance -= amount; // No, porque amount incluye mora.
    // El balance del cliente suele ser Capital + Interés pendiente.
    // Si pagamos mora, no baja el balance del cliente (usualmente).
    // Si pagamos interés, baja? Depende de cómo se sumó.
    // En createLoan, se sumó `totalToPay`.
    // Si es redito, `totalToPay` era `interestAmount * finalTerm + finalAmount`.
    // Entonces pagar interés BAJA el balance.

    // Vamos a mantener la lógica original de restar lo aplicado a capital e interés?
    // El código original hacía `client.balance = loan.balance`. Esto estaba MAL si hay múltiples préstamos.
    // Vamos a cambiarlo a decremento.

    const amountToReduceClientBalance_legacy = appliedToCapital + appliedToInterest; // Renaming to avoid conflict, though this line seems unused now.
    // Si es Rédito, createLoan sumaba `(interestAmount * finalTerm) + finalAmount`.
    // Entonces sí, pagar interés reduce deuda.

    // Pero espera, en Rédito, `loan.balance` se inicializaba como `finalAmount` (solo capital).
    // Entonces `client.balance` se incrementaba por `totalToPay` (Cap + Int).
    // Si `loan.balance` solo trackea capital, entonces `client.balance = loan.balance` es INCORRECTO porque borra los intereses del cliente.

    // FIX: Usar $inc en el cliente.
    // Calcular cuánto reducir el balance del cliente
    let amountToReduceClientBalance = 0;
    if (loan.lendingType === 'redito') {
      // En Rédito, el balance del cliente (deuda principal) solo baja si se abona a capital
      amountToReduceClientBalance = appliedToCapital;
    } else {
      // En otros, el balance incluye intereses, así que todo lo pagado (menos mora) reduce la deuda
      amountToReduceClientBalance = appliedToCapital + appliedToInterest;
    }

    await Client.findByIdAndUpdate(clientId, {
      $inc: { balance: -amountToReduceClientBalance }
    }).session(session);

    wallet.balance += amount;
    await wallet.save({ session });

    // D. Registrar Transacción
    const receiptId = `REC-${Date.now().toString().slice(-6)}`;

    const transaction = new Transaction({
      type: 'in_payment',
      amount: amount,
      category: 'Pago Préstamo',
      description: `Pago Préstamo #${loan._id.toString().slice(-6)} (Mora: ${appliedToMora})`,
      receiptId: receiptId,
      client: clientId,
      wallet: walletId,
      businessId: req.user.businessId,
      date: new Date(),
      metadata: {
        loanId: loan._id,
        breakdown: {
          interest: appliedToInterest,
          capital: appliedToCapital,
          mora: appliedToMora
        }
      }
    });
    await transaction.save({ session });

    await session.commitTransaction();

    // NOTIFICACIÓN: Pago Recibido
    try {
      // 5. Notificar
      await notificationController.createNotification(
        loan.businessId,
        'payment',
        `💰 Pago de $${amount} recibido de ${client.name}. Recibo #${receiptId}. Nuevo Saldo: $${loan.balance}`,
        transaction._id
      );

      // 6. Generar y Enviar PDF por Telegram
      const settings = await Settings.findOne({ businessId: loan.businessId });
      if (settings && settings.telegram && settings.telegram.enabled) {
        const pdfBuffer = await generateReceiptPDF(transaction, client, loan, settings);
        await notificationController.sendTelegramDocument(
          loan.businessId,
          `📄 Recibo de Pago #${receiptId}`,
          pdfBuffer,
          `Recibo_${client.name.replace(/\s+/g, '_')}_${receiptId}.pdf`
        );
      }

    } catch (notifError) {
      console.error('Error creando notificación de pago:', notifError);
    }

    res.json({ message: "Pago registrado", breakdown: { appliedToCapital, appliedToInterest, appliedToMora }, transaction });

  } catch (error) {
    await session.abortTransaction();
    console.error('❌ ERROR EN REGISTRAR PAGO:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: error.message, details: error.stack });
  } finally {
    session.endSession();
  }
};

// 4. LISTAR PRÉSTAMOS CON AUTO-RECÁLCULO DE MORA
exports.getLoans = async (req, res) => {
  try {
    const filter = req.businessFilter || { businessId: req.user.businessId };
    const loans = await Loan.find(filter).populate('client').sort({ createdAt: -1 });

    const settings = await Settings.findOne({ businessId: req.user.businessId });
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // Auto-recalcular mora y estado para cada préstamo
    let updated = 0;
    const loansWithMora = [];

    for (let loan of loans) {
      let changed = false;

      // Skip if already paid
      if (loan.status === 'paid') {
        loansWithMora.push(loan.toObject());
        continue;
      }

      // Recalcular overdue count con lógica corregida
      const overdueQuotas = loan.schedule.filter(q => {
        if (q.status !== 'pending') return false;
        const dueDate = new Date(q.dueDate);
        return dueDate < startOfToday; // Overdue after midnight
      });

      const overdueCount = overdueQuotas.length;

      // Recalcular late fee
      const newLateFee = calculateLateFee(loan, overdueCount, settings);
      if (Math.abs((loan.lateFee || 0) - newLateFee) > 0.01) {
        loan.lateFee = newLateFee;
        changed = true;
      }

      // Update status
      const newStatus = overdueCount > 0 ? 'past_due' : 'active';
      if (loan.status !== newStatus) {
        loan.status = newStatus;
        changed = true;
      }

      // Calculate days late (only counting working days)
      if (overdueQuotas.length > 0) {
        const oldestOverdue = overdueQuotas.reduce((oldest, q) => {
          const qDate = new Date(q.dueDate);
          return !oldest || qDate < oldest ? qDate : oldest;
        }, null);

        if (oldestOverdue) {
          let daysLate = 0;
          let currentDate = new Date(oldestOverdue);

          while (currentDate < startOfToday) {
            currentDate.setDate(currentDate.getDate() + 1);
            if (isWorkingDay(currentDate, settings)) {
              daysLate++;
            }
          }

          if (loan.daysLate !== daysLate) {
            loan.daysLate = daysLate;
            changed = true;
          }
        }
      } else if (loan.daysLate > 0) {
        loan.daysLate = 0;
        changed = true;
      }

      // Save if changed
      if (changed) {
        await loan.save();
        updated++;
      }

      loansWithMora.push({ ...loan.toObject(), lateFee: loan.lateFee || 0 });
    }

    console.log(`✅ Auto-recalculados ${updated} préstamos de ${loans.length}`);
    res.json(loansWithMora);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 5. OBTENER ATRASOS
exports.getArrears = async (req, res) => {
  try {
    const filter = req.businessFilter || { businessId: req.user.businessId };
    // Include past_due in the search
    const loans = await Loan.find({
      status: { $in: ['active', 'past_due'] },
      ...filter
    }).populate('client');

    const today = new Date();

    // Update statuses if needed
    const updatedLoans = await Promise.all(loans.map(async (loan) => {
      const hasOverdue = loan.schedule.some(q => q.status === 'pending' && new Date(q.dueDate) < today);
      let newStatus = loan.status;

      if (hasOverdue && loan.status !== 'past_due') {
        newStatus = 'past_due';
      } else if (!hasOverdue && loan.status === 'past_due') {
        newStatus = 'active';
      }

      if (newStatus !== loan.status) {
        loan.status = newStatus;
        await loan.save();
      }
      return loan;
    }));

    // Filter for response
    const arrears = updatedLoans
      .filter(l => l.status === 'past_due')
      .map(loan => {
        const overdueQuotas = loan.schedule.filter(q => q.status === 'pending' && new Date(q.dueDate) < today);
        const overdueCount = overdueQuotas.length;
        const lateFee = calculateLateFee(loan, overdueCount);

        const overdueInterest = overdueQuotas.reduce((acc, q) => acc + (q.interest || 0), 0);
        const overdueCapital = overdueQuotas.reduce((acc, q) => acc + (q.capital || 0), 0);

        const totalOverdue = lateFee + overdueInterest + overdueCapital;

        return {
          ...loan.toObject(),
          lateFee,
          totalOverdue,
          installmentsCount: overdueCount,
          daysLate: overdueQuotas.length > 0 ? Math.floor((today - new Date(overdueQuotas[0].dueDate)) / (1000 * 60 * 60 * 24)) : 0,
          overdueInstallments: overdueQuotas
        };
      });

    res.json(arrears);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// 5. DETALLE PAGO
exports.getPaymentDetails = async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id).populate('client');
    if (!loan) return res.status(404).json({ error: "No encontrado" });

    // Fetch settings for late fee calculation
    const settings = await Settings.findOne({ businessId: req.user.businessId || loan.businessId });

    // FIX: Actualizar estado si está vencido o pagado al consultar detalle
    let newStatus = loan.status;

    // 1. Check if Paid (Self-healing)
    if (loan.balance <= 0.1 && loan.status !== 'paid') {
      newStatus = 'paid';
    }
    // 2. Check Overdue
    else if (newStatus !== 'paid' && newStatus !== 'bad_debt') {
      const today = new Date();
      const hasOverdue = loan.schedule.some(q => q.status === 'pending' && new Date(q.dueDate) < today);

      if (hasOverdue && newStatus !== 'past_due') {
        newStatus = 'past_due';
      } else if (!hasOverdue && newStatus === 'past_due') {
        newStatus = 'active';
      }
    }

    if (newStatus !== loan.status) {
      loan.status = newStatus;
      await loan.save();
    }

    // 2. Calcular Deuda Vencida (Interés + Capital Vencido)
    const today = new Date();
    const pendingInstallments = loan.schedule.filter(q => q.status === 'pending' && new Date(q.dueDate) <= today);

    let pendingInterest = 0;
    let pendingCapital = 0;
    let overdueCount = 0;

    pendingInstallments.forEach(q => {
      pendingInterest += (q.interest || 0);
      pendingCapital += (q.capital || 0);
      overdueCount++;
    });

    // 3. Calcular Mora
    const lateFee = calculateLateFee(loan, overdueCount);

    // FIX: Para Rédito, incluir la próxima cuota pendiente aunque no esté vencida, para permitir pago anticipado de interés/cancelación
    if (loan.lendingType === 'redito') {
      const nextQuota = loan.schedule.find(q => q.status === 'pending' && new Date(q.dueDate) > today);
      if (nextQuota) {
        pendingInterest += (nextQuota.interest || 0);
        // No incrementamos overdueCount para no cobrar mora injusta
      }
    }

    // 4. Estructurar Respuesta
    let suggestedAmount = 0;
    let breakdown = {
      interest: pendingInterest,
      capital: pendingCapital,
      mora: lateFee,
      totalPending: pendingInterest + pendingCapital + lateFee
    };

    let payoffAmount = 0;
    let currentDebt = 0;

    if (loan.lendingType === 'redito') {
      // En Rédito: Se sugiere pagar los intereses vencidos + Mora
      suggestedAmount = pendingInterest + lateFee;

      // Deuda Total = Capital Original + Intereses Vencidos + Mora
      currentDebt = loan.amount + pendingInterest + lateFee;

      // Para saldar = Deuda Total
      payoffAmount = currentDebt;
    } else {
      // En otros: Se sugiere pagar lo vencido (Cap + Int + Mora)
      suggestedAmount = pendingInterest + pendingCapital + lateFee;

      // Deuda Total = Balance Actual + Mora (El balance ya incluye capital pendiente)
      currentDebt = loan.balance + lateFee;
      payoffAmount = currentDebt;
    }

    res.json({
      suggestedAmount,
      breakdown,
      payoffAmount,
      currentDebt,
      lendingType: loan.lendingType
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// 6. ELIMINAR PRÉSTAMO
exports.deleteLoan = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const loan = await Loan.findById(req.params.id).session(session);
    if (!loan) throw new Error("Préstamo no encontrado");

    // 1. Revertir Caja (Devolver desembolso)
    let wallet = await Wallet.findOne({ isDefault: true, businessId: req.user.businessId }).session(session);
    if (!wallet) wallet = await Wallet.findOne({ businessId: req.user.businessId }).session(session);

    if (wallet) {
      wallet.balance += loan.amount;
      const totalPaid = loan.schedule.reduce((acc, q) => acc + (q.paidAmount || 0), 0);
      wallet.balance -= totalPaid;
      await wallet.save({ session });
    }

    // 2. Revertir Cliente (Quitar deuda)
    await Client.findByIdAndUpdate(loan.client, {
      $inc: { balance: -loan.balance }
    }).session(session);

    // 3. Eliminar Transacciones asociadas
    const loanIdStr = loan._id.toString().slice(-6);
    await Transaction.deleteMany({
      businessId: req.user.businessId,
      description: { $regex: loanIdStr }
    }).session(session);

    // 4. Eliminar Préstamo
    await Loan.findByIdAndDelete(req.params.id).session(session);

    await session.commitTransaction();
    res.json({ message: "Préstamo eliminado y transacciones revertidas." });

  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ error: error.message });
  } finally {
    session.endSession();
  }
};

// 7. ACTUALIZAR PRÉSTAMO
exports.updateLoan = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const loan = await Loan.findById(req.params.id).session(session);
    if (!loan) throw new Error("Préstamo no encontrado");

    // Validar que no tenga pagos
    const hasPayments = loan.schedule.some(q => (q.paidAmount || 0) > 0);
    // if (hasPayments) throw new Error("No se puede editar un préstamo con pagos registrados. Elimínelo y créelo de nuevo si es necesario.");
    if (hasPayments) console.log("⚠️ Editando préstamo con pagos previos. El schedule se reiniciará.");

    const { amount, interestRate, duration, frequency, lendingType } = req.body;

    // 1. Revertir impacto financiero ANTERIOR
    let wallet = await Wallet.findOne({ isDefault: true, businessId: req.user.businessId }).session(session);
    if (wallet) {
      wallet.balance += loan.amount; // Devolvemos el dinero anterior a caja
    }
    await Client.findByIdAndUpdate(loan.client, { $inc: { balance: -loan.balance } }).session(session); // Quitamos deuda anterior

    // 2. Calcular NUEVO esquema
    const settings = await Settings.findOne({ businessId: req.user.businessId }).session(session);
    const { schedule, totalToPay, finalRate, finalFreq, finalType, finalTerm, finalAmount } = calculateSchedule(
      amount, interestRate, duration, frequency, lendingType, settings, loan.createdAt
    );

    // 3. Aplicar NUEVO impacto financiero
    if (wallet) {
      if (wallet.balance < finalAmount) throw new Error("Fondos insuficientes en caja para el nuevo monto.");
      wallet.balance -= finalAmount;
      await wallet.save({ session });
    }
    await Client.findByIdAndUpdate(loan.client, { $inc: { balance: totalToPay } }).session(session);

    // 4. Actualizar Préstamo
    loan.amount = finalAmount;
    loan.currentCapital = finalAmount;
    loan.interestRate = finalRate;
    loan.duration = finalTerm;
    loan.frequency = finalFreq;
    loan.lendingType = finalType;
    loan.totalToPay = totalToPay;
    loan.balance = totalToPay;
    loan.schedule = schedule;

    await loan.save({ session });

    // 5. Actualizar Transacción
    const loanIdStr = loan._id.toString().slice(-6);
    await Transaction.findOneAndUpdate(
      { businessId: req.user.businessId, description: { $regex: loanIdStr }, type: 'out_loan' },
      { amount: finalAmount, date: new Date() }
    ).session(session);

    await session.commitTransaction();
    res.json(loan);

  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ error: error.message });
  } finally {
    session.endSession();
  }
};

// 2.1 OBTENER UN PRÉSTAMO
exports.getLoan = async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id).populate('client');
    if (!loan) return res.status(404).json({ error: "Préstamo no encontrado" });

    // Seguridad: Verificar businessId
    // Seguridad: Verificar businessId
    if (loan.businessId.toString() !== req.user.businessId.toString()) {
      return res.status(403).json({ error: "Acceso denegado" });
    }

    // Calcular Mora
    const today = new Date();
    const settings = await Settings.findOne({ businessId: req.user.businessId });
    const overdueCount = loan.schedule.filter(q => q.status === 'pending' && new Date(q.dueDate) < today).length;
    const lateFee = calculateLateFee(loan, overdueCount, settings);

    res.json({ ...loan.toObject(), lateFee: lateFee || 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
// DELETE PAYMENT TRANSACTION
exports.deletePayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { transactionId } = req.params;

    // Find the transaction
    const transaction = await Transaction.findById(transactionId).session(session);
    if (!transaction) {
      await session.abortTransaction();
      return res.status(404).json({ error: "Transacción no encontrada" });
    }

    // Get loan ID from metadata
    const loanId = transaction.metadata?.loanId || transaction.loan;
    if (!loanId) {
      await session.abortTransaction();
      return res.status(400).json({ error: "No se puede identificar el préstamo asociado" });
    }

    const loan = await Loan.findById(loanId).session(session);
    if (!loan) {
      await session.abortTransaction();
      return res.status(404).json({ error: "Préstamo no encontrado" });
    }

    // Reverse the payment from loan schedule
    const breakdown = transaction.metadata?.breakdown || { appliedToCapital: 0, appliedToInterest: 0, appliedToMora: 0 };

    for (let quota of loan.schedule) {
      if (quota.paidAmount > 0) {
        // Reverse interest payment
        if (quota.paidInterest && breakdown.appliedToInterest > 0) {
          const toReverse = Math.min(quota.paidInterest, breakdown.appliedToInterest);
          quota.paidInterest -= toReverse;
          breakdown.appliedToInterest -= toReverse;
        }

        // Reverse capital payment
        if (quota.paidCapital && breakdown.appliedToCapital > 0) {
          const toReverse = Math.min(quota.paidCapital, breakdown.appliedToCapital);
          quota.paidCapital -= toReverse;
          breakdown.appliedToCapital -= toReverse;
        }

        // Update quota status
        quota.paidAmount = (quota.paidInterest || 0) + (quota.paidCapital || 0);
        if (quota.paidAmount < quota.amount) {
          quota.status = 'pending';
        }
      }
    }

    // Restore loan balance
    loan.balance += transaction.amount;

    // Update client balance
    const client = await Client.findById(loan.client).session(session);
    if (client) {
      client.balance += transaction.amount;
      await client.save({ session });
    }

    // Restore wallet balance (reverse the income)
    const wallet = await Wallet.findById(transaction.wallet).session(session);
    if (wallet) {
      wallet.balance -= transaction.amount;
      await wallet.save({ session });
    }

    // Delete the transaction
    await Transaction.findByIdAndDelete(transactionId).session(session);

    // Save loan changes
    await loan.save({ session });

    await session.commitTransaction();
    res.json({ message: "Pago eliminado correctamente", loan });

  } catch (error) {
    await session.abortTransaction();
    console.error(error);
    res.status(500).json({ error: error.message });
  } finally {
    session.endSession();
  }
};

// RECALCULATE ALL OVERDUE LOANS
exports.recalculateOverdue = async (req, res) => {
  try {
    const filter = req.businessFilter || { businessId: req.user.businessId };
    const loans = await Loan.find({
      status: { $in: ['active', 'past_due'] },
      ...filter
    });

    const settings = await Settings.findOne({ businessId: req.user.businessId });
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    let updated = 0;

    for (let loan of loans) {
      let changed = false;

      // Recalculate overdue count with corrected logic
      const overdueQuotas = loan.schedule.filter(q => {
        if (q.status !== 'pending') return false;
        const dueDate = new Date(q.dueDate);
        return dueDate < startOfToday; // Overdue after midnight
      });

      const overdueCount = overdueQuotas.length;

      // Recalculate late fee
      const newLateFee = calculateLateFee(loan, overdueCount, settings);
      if (loan.lateFee !== newLateFee) {
        loan.lateFee = newLateFee;
        changed = true;
      }

      // Update status
      const newStatus = overdueCount > 0 ? 'past_due' : 'active';
      if (loan.status !== newStatus && loan.status !== 'paid') {
        loan.status = newStatus;
        changed = true;
      }

      // Calculate days late (only counting working days)
      if (overdueQuotas.length > 0) {
        const firstOverdueDate = new Date(overdueQuotas[0].dueDate);
        let daysLate = 0;

        // Count working days between firstOverdueDate and today
        let currentDate = new Date(firstOverdueDate);
        while (currentDate < startOfToday) {
          if (isWorkingDay(currentDate, settings)) {
            daysLate++;
          }
          currentDate.setDate(currentDate.getDate() + 1);
        }

        if (loan.daysLate !== daysLate) {
          loan.daysLate = daysLate;
          changed = true;
        }
      } else if (loan.daysLate > 0) {
        loan.daysLate = 0;
        changed = true;
      }

      if (changed) {
        await loan.save();
        updated++;
      }
    }

    res.json({
      message: `Recalculados ${updated} préstamos`,
      totalProcessed: loans.length,
      updated
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};


// UPDATE PAYMENT AMOUNT
exports.updatePaymentAmount = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { transactionId } = req.params;
    const { newAmount } = req.body;

    if (!newAmount || newAmount <= 0) {
      await session.abortTransaction();
      return res.status(400).json({ error: "Monto inválido" });
    }

    // Find the transaction
    const transaction = await Transaction.findById(transactionId).session(session);
    if (!transaction) {
      await session.abortTransaction();
      return res.status(404).json({ error: "Transacción no encontrada" });
    }

    const originalAmount = transaction.amount;

    // Get loan ID from metadata
    const loanId = transaction.metadata?.loanId || transaction.loan;
    if (!loanId) {
      await session.abortTransaction();
      return res.status(400).json({ error: "No se puede identificar el préstamo asociado" });
    }

    const loan = await Loan.findById(loanId).session(session);
    if (!loan) {
      await session.abortTransaction();
      return res.status(404).json({ error: "Préstamo no encontrado" });
    }

    // STEP 1: Revert original payment
    const oldBreakdown = transaction.metadata?.breakdown || { appliedToCapital: 0, appliedToInterest: 0, appliedToMora: 0 };

    for (let quota of loan.schedule) {
      if (quota.paidAmount > 0) {
        // Reverse interest payment
        if (quota.paidInterest && oldBreakdown.appliedToInterest > 0) {
          const toReverse = Math.min(quota.paidInterest, oldBreakdown.appliedToInterest);
          quota.paidInterest -= toReverse;
          oldBreakdown.appliedToInterest -= toReverse;
        }

        // Reverse capital payment
        if (quota.paidCapital && oldBreakdown.appliedToCapital > 0) {
          const toReverse = Math.min(quota.paidCapital, oldBreakdown.appliedToCapital);
          quota.paidCapital -= toReverse;
          oldBreakdown.appliedToCapital -= toReverse;
        }

        // Update quota status
        quota.paidAmount = (quota.paidInterest || 0) + (quota.paidCapital || 0);
        if (quota.paidAmount < quota.amount) {
          quota.status = 'pending';
        }
      }
    }

    // Restore loan balance
    loan.balance += originalAmount;

    // STEP 2: Apply new payment with new amount
    const settings = await Settings.findOne({ businessId: req.user.businessId });

    // Recalculate late fee
    const today = new Date();
    const overdueInstallments = loan.schedule.filter(q => q.status === 'pending' && new Date(q.dueDate) < today).length;
    const totalLateFee = calculateLateFee(loan, overdueInstallments, settings);

    let appliedToMora = 0;
    let appliedToInterest = 0;
    let appliedToCapital = 0;
    let remainingAmount = newAmount;

    // Apply to mora first
    if (totalLateFee > 0) {
      appliedToMora = Math.min(remainingAmount, totalLateFee);
      remainingAmount -= appliedToMora;
    }

    // Apply to installments
    for (let quota of loan.schedule) {
      if (quota.status !== 'pending' || remainingAmount <= 0) continue;

      const dueDate = new Date(quota.dueDate);
      if (dueDate > today) break; // Solo pagar cuotas vencidas o actuales

      const pendingInterest = (quota.interest || 0) - (quota.paidInterest || 0);
      const pendingCapital = (quota.capital || 0) - (quota.paidCapital || 0);

      // Pay interest first
      if (pendingInterest > 0) {
        const toPayInterest = Math.min(remainingAmount, pendingInterest);
        quota.paidInterest = (quota.paidInterest || 0) + toPayInterest;
        appliedToInterest += toPayInterest;
        remainingAmount -= toPayInterest;
      }

      // Then capital
      if (remainingAmount > 0 && pendingCapital > 0) {
        const toPayCapital = Math.min(remainingAmount, pendingCapital);
        quota.paidCapital = (quota.paidCapital || 0) + toPayCapital;
        appliedToCapital += toPayCapital;
        remainingAmount -= toPayCapital;
      }

      // Update quota status
      quota.paidAmount = (quota.paidInterest || 0) + (quota.paidCapital || 0);
      if (quota.paidAmount >= quota.amount) {
        quota.status = 'paid';
        quota.paidDate = transaction.date; // Keep original date
      }
    }

    // Update loan balance
    loan.balance -= appliedToCapital;

    // Update client balance
    const client = await Client.findById(loan.client).session(session);
    if (client) {
      client.balance += originalAmount - newAmount; // Adjust client balance
      await client.save({ session });
    }

    // Update wallet balance
    const wallet = await Wallet.findById(transaction.wallet).session(session);
    if (wallet) {
      wallet.balance -= originalAmount - newAmount; // Adjust wallet balance
      await wallet.save({ session });
    }

    // Update transaction
    transaction.amount = newAmount;
    transaction.metadata = {
      ...transaction.metadata,
      breakdown: {
        appliedToCapital,
        appliedToInterest,
        appliedToMora
      },
      originalAmount, // Store original for reference
      edited: true,
      editDate: new Date()
    };

    await transaction.save({ session });
    await loan.save({ session });

    await session.commitTransaction();
    res.json({
      message: "Monto actualizado correctamente",
      transaction,
      loan,
      breakdown: { appliedToCapital, appliedToInterest, appliedToMora }
    });

  } catch (error) {
    await session.abortTransaction();
    console.error(error);
    res.status(500).json({ error: error.message });
  } finally {
    session.endSession();
  }
};

// UPDATE PENALTY CONFIG (permite editar mora incluso con pagos)
exports.updatePenaltyConfig = async (req, res) => {
  try {
    const { loanId } = req.params;
    const { penaltyConfig } = req.body;

    if (!penaltyConfig) {
      return res.status(400).json({ error: "penaltyConfig es requerido" });
    }

    const loan = await Loan.findById(loanId);
    if (!loan) {
      return res.status(404).json({ error: "Préstamo no encontrado" });
    }

    // Security: verify businessId
    if (loan.businessId.toString() !== req.user.businessId.toString()) {
      return res.status(403).json({ error: "Acceso denegado" });
    }

    // Update penalty config
    loan.penaltyConfig = {
      type: penaltyConfig.type || 'fixed',
      value: penaltyConfig.value || 0,
      gracePeriod: penaltyConfig.gracePeriod || 0
    };

    await loan.save();

    // Recalculate late fee with new config
    const settings = await Settings.findOne({ businessId: req.user.businessId });
    const today = new Date();
    const overdueCount = loan.schedule.filter(q => q.status === 'pending' && new Date(q.dueDate) < today).length;
    const newLateFee = calculateLateFee(loan, overdueCount, settings);

    loan.lateFee = newLateFee;
    await loan.save();

    res.json({
      message: "Configuración de mora actualizada",
      loan,
      newLateFee
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};
