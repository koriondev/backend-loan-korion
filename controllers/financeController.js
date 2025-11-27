const Transaction = require('../models/Transaction');
const Client = require('../models/Client');
const Wallet = require('../models/Wallet');

// --- GESTIÓN DE TRANSACCIONES (Cobros, Gastos, Ingresos) ---

exports.createTransaction = async (req, res) => {
  try {
    const { type, amount, clientId, walletId, category, description } = req.body;

    // 1. Validar monto
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: "El monto debe ser mayor a 0" });
    }

    // 2. Buscar Cartera
    let wallet;
    if (walletId) {
      wallet = await Wallet.findById(walletId);
    } else {
      // Fallback: buscar la primera de ESTA empresa
      wallet = await Wallet.findOne({ businessId: req.user.businessId });
    }

    if (!wallet) return res.status(404).json({ error: "Cartera no encontrada" });

    // --- 3. ACTUALIZACIÓN MATEMÁTICA SEGURA ---
    const currentBalance = Number(wallet.balance) || 0; // Forzar número
    const amountToProcess = Number(amount);

    if (['in_payment', 'entry'].includes(type)) {
      wallet.balance = currentBalance + amountToProcess;
    } else {
      wallet.balance = currentBalance - amountToProcess;
    }

    // Evitar errores de decimales flotantes (ej: 10.0000001)
    wallet.balance = Math.round(wallet.balance * 100) / 100;

    await wallet.save();

    // 4. Si es cobro, actualizar cliente
    if (type === 'in_payment' && clientId) {
      const client = await Client.findById(clientId);
      if (client) {
        // También aseguramos matemática aquí
        const clientBalance = Number(client.balance) || 0;
        client.balance = clientBalance - amountToProcess;

        if (client.balance <= 0.5) { // Pequeña tolerancia
          client.balance = 0;
          client.status = 'paid';
        }
        await client.save();
      }
    }

    // 5. CREAR TRANSACCIÓN
    const newTx = new Transaction({
      type,
      amount: amountToProcess,
      category: category || (type === 'entry' ? 'Ingreso Manual' : 'Gasto'),
      description: description || '-',
      client: clientId || null,
      wallet: wallet._id,
      businessId: req.user.businessId, // Obligatorio
      date: new Date()
    });

    await newTx.save();

    res.status(201).json(newTx);

  } catch (error) {
    console.error("Error en transacción:", error);
    res.status(500).json({ error: error.message });
  }
};

// Función auxiliar para descripciones por defecto
function getDefaultCategory(type) {
  const map = {
    'in_payment': 'Cobro de Cuota',
    'out_loan': 'Desembolso Préstamo',
    'entry': 'Aporte de Capital',
    'exit': 'Gasto Operativo'
  };
  return map[type] || 'General';
}

function getDefaultDescription(type) {
  const map = {
    'in_payment': 'Pago recibido de cliente',
    'out_loan': 'Dinero entregado a cliente',
    'entry': 'Ingreso manual a caja',
    'exit': 'Retiro manual de caja'
  };
  return map[type] || '-';
}


// --- GESTIÓN DE CARTERAS (WALLETS) ---

// 1. Obtener todas las carteras (DE MI NEGOCIO)
exports.getWallets = async (req, res) => {
  try {
    // Usamos el filtro automático del middleware o forzamos el ID
    const filter = req.businessFilter || { businessId: req.user.businessId };

    const wallets = await Wallet.find(filter);
    res.json(wallets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 2. Crear nueva cartera (Capital Inicial)
exports.createWallet = async (req, res) => {
  try {
    const { name, initialBalance } = req.body;

    if (!name) return res.status(400).json({ error: "El nombre es requerido" });

    // --- VALIDACIÓN SAAS: LÍMITE DE CARTERAS ---
    // Opcional: Verificar si su plan permite más carteras
    // const walletCount = await Wallet.countDocuments({ businessId: req.user.businessId });
    // if (walletCount >= limit) ...

    const balance = Number(initialBalance) || 0;

    const newWallet = new Wallet({
      name,
      balance,
      isDefault: false,
      businessId: req.user.businessId // <--- ¡ESTA LÍNEA FALTABA!
    });

    await newWallet.save();

    // Crear registro histórico del ingreso inicial
    if (balance > 0) {
      const initialTx = new Transaction({
        type: 'entry',
        amount: balance,
        category: 'Capital Inicial',
        description: `Apertura de cartera: ${name}`,
        wallet: newWallet._id,
        businessId: req.user.businessId, // <--- También a la transacción
        date: new Date()
      });
      await initialTx.save();
    }

    res.status(201).json(newWallet);
  } catch (error) {
    console.error(error); // Para ver el error en los logs
    res.status(400).json({ error: error.message });
  }
};

// 3. Obtener Historial Global
exports.getHistory = async (req, res) => {
  try {
    // 1. Validación de Seguridad
    if (!req.user || !req.user.businessId) {
      // Si no sabemos de qué empresa es, devolvemos array vacío en vez de explotar
      return res.json([]);
    }

    // 2. Filtro Automático
    // Si es TI, req.businessFilter vendrá vacío (ver todo)
    // Si es Admin/Cobrador, vendrá { businessId: '...' }
    const filter = req.businessFilter || { businessId: req.user.businessId };

    const history = await Transaction.find(filter)
      .populate('client', 'name') // Traer nombre del cliente
      .populate('wallet', 'name') // Traer nombre de la cartera
      .sort({ date: -1 }) // Más reciente primero
      .limit(200); // Límite de seguridad

    res.json(history);

  } catch (error) {
    console.error("Error Historial:", error);
    res.status(500).json({ error: "Error interno al cargar historial" });
  }
};
// ... (código anterior) ...

// 3. Eliminar Cartera
exports.deleteWallet = async (req, res) => {
  try {
    const { id } = req.params;
    // Opcional: Verificar que el balance sea 0 antes de borrar
    // const wallet = await Wallet.findById(id);
    // if (wallet.balance !== 0) return res.status(400).json({ error: "No se puede eliminar una cartera con fondos." });

    await Wallet.findByIdAndDelete(id);
    // También podríamos borrar las transacciones asociadas si quisiéramos limpiar todo
    res.json({ message: "Cartera eliminada" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 4. Obtener Movimientos de una Cartera Específica
exports.getWalletDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const wallet = await Wallet.findById(id);
    const transactions = await Transaction.find({ wallet: id })
      .sort({ date: -1 })
      .populate('client', 'name'); // Ver quién pagó

    res.json({ wallet, transactions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 5. Establecer Cartera por Defecto (Para Préstamos)
exports.setWalletDefault = async (req, res) => {
  try {
    const { id } = req.params;

    // Desmarcar todas
    await Wallet.updateMany({}, { isDefault: false });

    // Marcar la seleccionada
    const wallet = await Wallet.findByIdAndUpdate(id, { isDefault: true }, { new: true });

    res.json(wallet);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 6. Eliminar Transacción (Solo las que NO están atadas a clientes/préstamos)
exports.deleteTransaction = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Buscar la transacción
    const transaction = await Transaction.findById(id);

    if (!transaction) {
      return res.status(404).json({ error: "Transacción no encontrada" });
    }

    // 2. Verificar que pertenece a la empresa del usuario (Seguridad SaaS)
    if (transaction.businessId.toString() !== req.user.businessId.toString()) {
      return res.status(403).json({ error: "No tienes permiso para eliminar esta transacción" });
    }

    // 3. VALIDACIÓN CRÍTICA: Solo se pueden eliminar transacciones SIN cliente
    if (transaction.client) {
      return res.status(400).json({
        error: "No se puede eliminar esta transacción porque está asociada a un cliente. Solo se pueden eliminar movimientos internos (ingresos/gastos manuales)."
      });
    }

    // 4. Revertir el balance de la cartera
    const wallet = await Wallet.findById(transaction.wallet);

    if (!wallet) {
      return res.status(404).json({ error: "Cartera asociada no encontrada" });
    }

    const currentBalance = Number(wallet.balance) || 0;
    const amountToReverse = Number(transaction.amount);

    // Revertir según el tipo de transacción
    if (['in_payment', 'entry'].includes(transaction.type)) {
      // Si fue un ingreso, ahora lo restamos
      wallet.balance = currentBalance - amountToReverse;
    } else {
      // Si fue un gasto, ahora lo sumamos de vuelta
      wallet.balance = currentBalance + amountToReverse;
    }

    // Evitar errores de decimales flotantes
    wallet.balance = Math.round(wallet.balance * 100) / 100;
    await wallet.save();

    // 5. Eliminar la transacción
    await Transaction.findByIdAndDelete(id);

    res.json({
      message: "Transacción eliminada exitosamente",
      newWalletBalance: wallet.balance
    });

  } catch (error) {
    console.error("Error eliminando transacción:", error);
    res.status(500).json({ error: error.message });
  }
};