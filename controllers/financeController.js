const Transaction = require('../models/Transaction');
const Client = require('../models/Client');
const Wallet = require('../models/Wallet');

// --- GESTIÓN DE TRANSACCIONES (Cobros, Gastos, Ingresos) ---

exports.createTransaction = async (req, res) => {
  try {
    const { type, amount, clientId, walletId, category, description } = req.body;

    // 1. Validaciones básicas
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "El monto debe ser mayor a 0" });
    }

    // 2. Buscar la Cartera afectada
    // Si el frontend envía walletId, usamos esa. Si no, buscamos la primera disponible (Default)
    let wallet;
    if (walletId) {
      wallet = await Wallet.findById(walletId);
    } else {
      wallet = await Wallet.findOne(); // Fallback: usar la primera que encuentre
    }

    if (!wallet) {
      return res.status(404).json({ error: "No se encontró ninguna cartera para procesar el dinero." });
    }

    // 3. Lógica Financiera según el tipo
    if (type === 'in_payment') {
      // COBRO: Entra dinero a caja, disminuye deuda cliente
      wallet.balance += Number(amount);
      
      if (clientId) {
        const client = await Client.findById(clientId);
        if (client) {
          client.balance -= Number(amount);
          // Si el balance llega a 0 (o menos por error), marcar como pagado
          if (client.balance <= 0) {
            client.balance = 0;
            client.status = 'paid';
          }
          await client.save();
        }
      }
    } 
    else if (type === 'out_loan') {
      // DESEMBOLSO: Sale dinero de caja (hacia el cliente)
      // Nota: La deuda del cliente usualmente se crea en loanController, aquí solo movemos la plata.
      wallet.balance -= Number(amount);
    }
    else if (type === 'entry') {
      // INGRESO CAPITAL: Entra dinero (Aporte de socio, etc)
      wallet.balance += Number(amount);
    }
    else if (type === 'exit') {
      // GASTO: Sale dinero (Gasolina, Comida, Retiro)
      wallet.balance -= Number(amount);
    }

    // 4. Guardar cambios en la Cartera
    await wallet.save();

    // 5. Registrar la Transacción en el Historial
    const newTx = new Transaction({
      type,
      amount: Number(amount),
      category: category || getDefaultCategory(type),
      description: description || getDefaultDescription(type),
      client: clientId || null,
      wallet: wallet._id, // Guardamos referencia de qué cartera se usó
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