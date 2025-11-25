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

// 1. CREAR PRÉSTAMO
exports.createLoan = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { clientId, productId, amount, interestRate, duration, frequency, type } = req.body;

    // --- A. DEFINIR REGLAS DEL JUEGO (Producto vs Manual) ---
    let finalRate = Number(interestRate) || 0;
    let finalFreq = frequency || 'weekly';
    let finalType = type || 'simple';
    let finalTerm = Number(duration) || 12;

    // Si seleccionó un producto, este MANDA sobre los datos manuales
    if (productId) {
      const product = await Product.findById(productId).session(session);
      if (!product) throw new Error("El producto seleccionado no existe.");

      finalRate = product.interestRate;
      finalFreq = product.frequency;
      finalType = product.interestType;
      finalTerm = product.duration;
    }

    // Validaciones de seguridad
    if (finalRate < 0) throw new Error("La tasa de interés no puede ser negativa.");
    if (finalTerm <= 0) throw new Error("El plazo debe ser mayor a 0.");
    if (Number(amount) <= 0) throw new Error("El monto debe ser mayor a 0.");

    // --- B. VALIDAR CAJA ---
    let wallet = await Wallet.findOne({ isDefault: true, businessId: req.user.businessId }).session(session);
    if (!wallet) wallet = await Wallet.findOne({ businessId: req.user.businessId }).session(session);

    if (!wallet) throw new Error("No tienes una cartera creada para desembolsar dinero.");
    if (wallet.balance < amount) throw new Error(`Fondos insuficientes en ${wallet.name} (Disponible: ${wallet.balance}).`);

    // --- C. MOTOR MATEMÁTICO ---
    let schedule = [];
    let totalToPay = 0;
    const rateDecimal = finalRate / 100;

    if (finalType === 'simple') {
      // INTERÉS SIMPLE (FLAT): Interés se calcula sobre el capital inicial y se congela.
      // Total Interés = Monto * Tasa
      // Cuota = (Monto + Interés) / Plazo

      const totalInterest = amount * rateDecimal;
      totalToPay = Number(amount) + totalInterest;
      const paymentAmount = totalToPay / finalTerm;

      // Desglose fijo por cuota
      const capitalPerQuota = amount / finalTerm;
      const interestPerQuota = totalInterest / finalTerm;

      for (let i = 1; i <= finalTerm; i++) {
        schedule.push({
          number: i,
          dueDate: getNextDate(new Date(), i, finalFreq),
          amount: paymentAmount,
          capital: capitalPerQuota,
          interest: interestPerQuota,
          status: 'pending'
        });
      }
    } else {
      // SALDO INSOLUTO (REDUCING): El interés baja si pagas capital.
      // Usamos método de Cuota Fija (Francés) o Capital Fijo (Alemán).
      // Para simplificar y que cuadre con "Baja 1000, baja 100 interés", usaremos ALEMÁN (Amortización Constante).

      const capitalPerQuota = amount / finalTerm;
      let currentBalance = Number(amount);

      for (let i = 1; i <= finalTerm; i++) {
        // Interés del periodo = Saldo Pendiente * Tasa Periódica
        // Ajuste de tasa según frecuencia (aprox)
        let periodicRate = rateDecimal;
        if (finalFreq === 'weekly') periodicRate = rateDecimal / 4;

        const interestPart = currentBalance * periodicRate;
        const totalQuota = capitalPerQuota + interestPart;

        schedule.push({
          number: i,
          dueDate: getNextDate(new Date(), i, finalFreq),
          amount: totalQuota,
          capital: capitalPerQuota,
          interest: interestPart,
          status: 'pending'
        });

        currentBalance -= capitalPerQuota;
      }
      // Sumar el total real
      totalToPay = schedule.reduce((acc, q) => acc + q.amount, 0);
    }

    // --- D. GUARDAR EN BASE DE DATOS ---
    const newLoan = new Loan({
      client: clientId,
      businessId: req.user.businessId,
      amount,
      interestRate: finalRate,
      duration: finalTerm,
      frequency: finalFreq,
      type: finalType,
      totalToPay,
      balance: totalToPay,
      schedule,
      createdAt: new Date()
    });
    await newLoan.save({ session });

    // Actualizar Cliente
    await Client.findByIdAndUpdate(clientId, {
      status: 'active',
      $inc: { balance: totalToPay }
    }).session(session);

    // Descontar de Caja
    wallet.balance -= Number(amount);
    await wallet.save({ session });

    // Registrar Transacción
    const tx = new Transaction({
      type: 'out_loan',
      amount: Number(amount),
      category: 'Desembolso',
      description: `Préstamo #${newLoan._id.toString().slice(-6)} (${finalType})`,
      client: clientId,
      wallet: wallet._id,
      businessId: req.user.businessId,
      date: new Date()
    });
    await tx.save({ session });

    await session.commitTransaction();
    res.status(201).json(newLoan);

  } catch (error) {
    await session.abortTransaction();
    console.error("Error crear préstamo:", error);
    res.status(500).json({ error: error.message });
  } finally {
    session.endSession();
  }
};

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

// 3. REGISTRAR PAGO (CASCADE)
exports.registerPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { loanId, amount, walletId } = req.body;
    const paymentAmount = Number(amount);

    const loan = await Loan.findById(loanId).session(session);
    if (!loan) throw new Error("Préstamo no encontrado");

    const client = await Client.findById(loan.client).session(session);
    const wallet = await Wallet.findById(walletId).session(session);

    // Lógica simplificada de distribución
    let remaining = paymentAmount;
    let appliedInterest = 0;
    let appliedCapital = 0;
    let appliedMora = 0;

    // Pagar lo más viejo primero
    loan.schedule.forEach(q => {
      if (remaining > 0 && q.status !== 'paid') {
        const due = q.amount - (q.paidAmount || 0); // Simplificado
        const pay = Math.min(remaining, due);
        q.paidAmount = (q.paidAmount || 0) + pay;
        remaining -= pay;

        if (q.paidAmount >= q.amount - 0.1) {
          q.status = 'paid';
          q.paidDate = new Date();
        } else {
          q.status = 'partial';
        }

        // Asignación simple (proporcional)
        const capPart = (pay * (q.capital / q.amount)) || 0;
        const intPart = (pay * (q.interest / q.amount)) || 0;

        appliedCapital += capPart;
        appliedInterest += intPart;
      }
    });

    loan.balance -= paymentAmount;
    if (loan.balance < 1) loan.status = 'paid';

    client.balance -= paymentAmount;
    wallet.balance += paymentAmount;

    await loan.save({ session });
    await client.save({ session });
    await wallet.save({ session });

    const tx = new Transaction({
      type: 'in_payment',
      amount: paymentAmount,
      category: 'Pago Cuota',
      client: client._id,
      wallet: wallet._id,
      businessId: loan.businessId,
      date: new Date(),
      breakdown: { appliedCapital, appliedInterest, appliedMora }
    });
    await tx.save({ session });

    await session.commitTransaction();
    res.json({ message: "Pago exitoso", breakdown: { appliedCapital, appliedInterest, appliedMora } });

  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ error: error.message });
  } finally {
    session.endSession();
  }
};

// 4. ATRASOS
exports.getArrears = async (req, res) => {
  try {
    const filter = req.businessFilter || { businessId: req.user.businessId };
    const loans = await Loan.find({ status: 'active', ...filter }).populate('client');

    const today = new Date();
    const arrears = loans.filter(l =>
      l.schedule.some(q => new Date(q.dueDate) < today && q.status === 'pending')
    ).map(loan => {
      // Calcular mora básica
      return { ...loan.toObject(), totalOverdue: 500 }; // Placeholder mora
    });

    res.json(arrears);
  } catch (e) { res.status(500).json({ error: e.message }); }
};