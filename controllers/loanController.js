const mongoose = require('mongoose');
const Loan = require('../models/Loan');
const Client = require('../models/Client');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const Settings = require('../models/Settings');
const Product = require('../models/Product');

// Función auxiliar fechas
const getNextDate = (startDate, index, freq) => {
  const date = new Date(startDate);
  const daysMap = { 'daily': 1, 'weekly': 7, 'biweekly': 15, 'monthly': 30 };
  const daysToAdd = daysMap[freq] || 7;
  date.setDate(date.getDate() + (index * daysToAdd));
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
const calculateSchedule = (amount, rate, term, frequency, type) => {
  const finalRate = Number(rate) || 0;
  const finalFreq = frequency || 'weekly';
  const finalType = type || 'simple';
  const finalTerm = Number(term) || 12;
  const finalAmount = Number(amount);

  const periodicRate = getPeriodicRate(finalRate, finalFreq);
  const roundToNearestFive = (num) => Math.round(num / 5) * 5;

  let schedule = [];
  let totalToPay = 0;

  if (finalType === 'redito') {
    const interestAmount = roundToNearestFive(finalAmount * periodicRate);
    for (let i = 1; i <= finalTerm; i++) {
      schedule.push({
        number: i,
        dueDate: getNextDate(new Date(), i, finalFreq),
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
        dueDate: getNextDate(new Date(), i, finalFreq),
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
        dueDate: getNextDate(new Date(), i, finalFreq),
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

// HELPER: Calcular Mora
const calculateLateFee = (loan, overdueInstallments) => {
  if (!loan.penaltyConfig || overdueInstallments <= 0) return 0;

  const { type, value, gracePeriod } = loan.penaltyConfig;

  // Si hay días de gracia, verificar si realmente aplica (esto requeriría lógica más compleja por cuota)
  // Por simplicidad en esta versión, si tiene cuotas vencidas marcadas por el sistema, aplicamos mora.

  if (type === 'fixed') {
    return value * overdueInstallments; // Ej: 100 pesos por cada cuota vencida
  } else {
    // Porcentaje sobre la cuota vencida (Capital + Interés)
    // Asumimos que 'value' es un porcentaje (ej. 5 para 5%)
    // Necesitamos saber el monto de la cuota. En Rédito es el interés. En otros es la cuota fija.

    // Estimación rápida basada en la primera cuota del schedule (asumiendo cuotas iguales)
    const quotaAmount = loan.schedule[0]?.amount || 0;
    return (quotaAmount * (value / 100)) * overdueInstallments;
  }
};

// 0. PREVISUALIZAR PRÉSTAMO
exports.previewLoan = async (req, res) => {
  try {
    const { amount, interestRate, duration, frequency, type, lendingType } = req.body;
    const result = calculateSchedule(amount, interestRate, duration, frequency, lendingType || type);
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

    // Si no hay config, usar defaults globales (Settings)
    if (!finalPenaltyConfig) {
      const settings = await Settings.findOne({ businessId: req.user.businessId }).session(session);
      if (settings) {
        finalPenaltyConfig = {
          type: settings.lateFeeType,
          value: settings.lateFeeValue,
          gracePeriod: settings.gracePeriod
        };
      }
    }

    // B. MOTOR MATEMÁTICO
    const { schedule, totalToPay, finalRate, finalFreq, finalType, finalTerm, finalAmount } = calculateSchedule(
      calcParams.amount, calcParams.rate, calcParams.term, calcParams.freq, calcParams.type
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
    const { startDate: customStartDate, paidInstallments } = req.body;
    const loanStartDate = customStartDate ? new Date(customStartDate) : new Date();

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
    res.json(loans);
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
    if (amount <= 0) throw new Error("Monto inválido");
    if (amount > loan.balance + 1000) throw new Error("Monto excede deuda total (con margen)");

    // 3. Lógica de Distribución del Pago
    // Orden de prelación: Mora -> Interés -> Capital

    // Recalcular mora actual para cobrarla
    const today = new Date();
    const overdueInstallments = loan.schedule.filter(q => q.status === 'pending' && new Date(q.dueDate) <= today).length;
    const totalLateFee = calculateLateFee(loan, overdueInstallments);

    let remainingPayment = amount;
    let appliedToMora = 0;
    let appliedToInterest = 0;
    let appliedToCapital = 0;

    // A. Cobrar Mora
    if (totalLateFee > 0) {
      const moraToPay = Math.min(remainingPayment, totalLateFee);
      appliedToMora = moraToPay;
      remainingPayment -= moraToPay;
    }

    // B. Cobrar Intereses y Capital (Iterando cuotas)
    let currentPayment = remainingPayment;

    for (let i = 0; i < loan.schedule.length; i++) {
      if (currentPayment <= 0) break;
      let q = loan.schedule[i];

      if (q.status === 'pending') {
        // 1. Interés
        const interestPending = (q.interest || 0) - (q.paidInterest || 0);
        if (interestPending > 0) {
          const payInt = Math.min(currentPayment, interestPending);
          q.paidInterest = (q.paidInterest || 0) + payInt;
          appliedToInterest += payInt;
          currentPayment -= payInt;
        }

        // 2. Capital
        const capitalPending = (q.capital || 0) - (q.paidCapital || 0);
        if (capitalPending > 0 && currentPayment > 0) {
          const payCap = Math.min(currentPayment, capitalPending);
          q.paidCapital = (q.paidCapital || 0) + payCap;
          appliedToCapital += payCap;
          currentPayment -= payCap;
        }

        // Actualizar estado de cuota
        q.paidAmount = (q.paidInterest || 0) + (q.paidCapital || 0);

        if (q.paidInterest >= (q.interest - 0.1) && q.paidCapital >= (q.capital - 0.1)) {
          q.status = 'paid';
          q.paidDate = new Date();
        }
      }
    }

    // C. Actualizar Totales del Préstamo
    loan.balance -= appliedToCapital;

    // Guardar
    loan.markModified('schedule');
    await loan.save({ session });

    // Actualizar Cliente y Caja
    client.balance = loan.balance;
    wallet.balance += amount;

    await client.save({ session });
    await wallet.save({ session });

    // D. Registrar Transacción
    const transaction = new Transaction({
      type: 'in_payment',
      amount: amount,
      category: 'Pago Préstamo',
      description: `Pago Préstamo #${loan._id.toString().slice(-6)} (Mora: ${appliedToMora})`,
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
    res.json({ message: "Pago registrado", breakdown: { appliedToCapital, appliedToInterest, appliedToMora } });

  } catch (error) {
    await session.abortTransaction();
    console.error('❌ ERROR EN REGISTRAR PAGO:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: error.message, details: error.stack });
  } finally {
    session.endSession();
  }
};

// 4. OBTENER ATRASOS
exports.getArrears = async (req, res) => {
  try {
    const filter = req.businessFilter || { businessId: req.user.businessId };
    const loans = await Loan.find({ status: 'active', ...filter }).populate('client');

    const today = new Date();
    const arrears = loans.filter(l =>
      l.schedule.some(q => new Date(q.dueDate) < today && q.status === 'pending')
    ).map(loan => {
      return { ...loan.toObject(), totalOverdue: 500 };
    });

    res.json(arrears);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// 5. DETALLE PAGO
exports.getPaymentDetails = async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ error: "No existe" });

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
    if (hasPayments) throw new Error("No se puede editar un préstamo con pagos registrados. Elimínelo y créelo de nuevo si es necesario.");

    const { amount, interestRate, duration, frequency, lendingType } = req.body;

    // 1. Revertir impacto financiero ANTERIOR
    let wallet = await Wallet.findOne({ isDefault: true, businessId: req.user.businessId }).session(session);
    if (wallet) {
      wallet.balance += loan.amount; // Devolvemos el dinero anterior a caja
    }
    await Client.findByIdAndUpdate(loan.client, { $inc: { balance: -loan.balance } }).session(session); // Quitamos deuda anterior

    // 2. Calcular NUEVO esquema
    const { schedule, totalToPay, finalRate, finalFreq, finalType, finalTerm, finalAmount } = calculateSchedule(
      amount, interestRate, duration, frequency, lendingType
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