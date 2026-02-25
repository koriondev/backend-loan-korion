const Client = require('../models/Client');
const Loan = require('../models/Loan');

// 1. CREAR CLIENTE (Multi-tenant)
exports.createClient = async (req, res) => {
  try {
    // Validar que tengamos el contexto del negocio
    const businessId = req.user.businessId;

    // Si es TI y no tiene negocio, o si hay un error de token
    if (!businessId && req.user.role !== 'ti') {
      return res.status(403).json({ error: "No tienes permiso para crear clientes en este entorno." });
    }

    // Parse references if it's a string (from FormData)
    let references = req.body.references;
    if (typeof references === 'string') {
      try {
        references = JSON.parse(references);
      } catch (e) {
        references = [];
      }
    }

    // Prepare client data
    const clientData = {
      ...req.body,
      businessId: businessId,
      references: references || []
    };

    // Sanitize ObjectId fields (remove empty strings to avoid CastError)
    const objectIdFields = ['assignedTo', 'assignedInvestor', 'assignedManager', 'assignedWallet', 'createdBy'];
    objectIdFields.forEach(field => {
      if (clientData[field] === '' || clientData[field] === 'null' || clientData[field] === 'undefined') {
        delete clientData[field];
      }
    });

    // Handle uploaded files
    if (req.files) {
      if (req.files.idCardFront) {
        clientData.idCardFront = `/uploads/clients/${req.files.idCardFront[0].filename}`;
      }
      if (req.files.idCardBack) {
        clientData.idCardBack = `/uploads/clients/${req.files.idCardBack[0].filename}`;
      }
      if (req.files.photo) {
        clientData.photo = `/uploads/clients/${req.files.photo[0].filename}`;
      }
    }

    // 0. Validar Duplicados (Cédula)
    if (clientData.cedula) {
      const existing = await Client.findOne({ cedula: clientData.cedula, businessId });
      if (existing) {
        return res.status(400).json({ error: "Ya existe un cliente con esta cédula." });
      }
    }

    // 1. Asignar Audit Info
    clientData.createdBy = req.user._id;
    clientData.balance = 0; // Asegurar 0

    // Creamos el cliente asignándole el ID del negocio automáticamente
    const newClient = new Client(clientData);

    const savedClient = await newClient.save();
    res.status(201).json(savedClient);
  } catch (error) {
    console.error('Error creating client:', error);
    res.status(400).json({ error: error.message });
  }
};
/** 2. OBTENER CLIENTES (Filtrado por Negocio)
exports.getClients = async (req, res) => {
  try {
    // req.businessFilter viene del middleware (authMiddleware.js)
    // Automáticamente filtra: { businessId: 'tu_id_empresa' }
    const clients = await Client.find(req.businessFilter).sort({ createdAt: -1 });
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}; */
// 2. Obtener clientes (CON DEBUG)
exports.getClients = async (req, res) => {
  try {
    console.log('------------------------------------------------');
    console.log('🔍 DEBUG CLIENTES:');
    console.log('👤 Usuario solicitante:', req.user.email, '| Rol:', req.user.role);
    console.log('🏢 ID de Empresa en Token:', req.user.businessId);
    console.log('🛡️ Filtro aplicado por el sistema:', req.businessFilter);

    // Búsqueda real
    const clients = await Client.find(req.businessFilter).sort({ createdAt: -1 });

    console.log(`✅ Resultados encontrados: ${clients.length}`);
    console.log('------------------------------------------------');

    res.json(clients);
  } catch (error) {
    console.error("❌ Error fatal:", error);
    res.status(500).json({ error: error.message });
  }
};


// 3. OBTENER PERFIL 360 (Detalle)
exports.getClientProfile = async (req, res) => {
  try {
    const { id } = req.params;

    // Buscamos el cliente asegurando que pertenezca a mi negocio
    const client = await Client.findOne({ _id: id, ...req.businessFilter });

    if (!client) return res.status(404).json({ message: "Cliente no encontrado o no pertenece a tu empresa" });

    // Historial de Préstamos
    const loansV1 = await Loan.find({ client: id }).sort({ createdAt: -1 });

    // Cargar también V2 si existen para el cliente
    let mappedV2 = [];
    try {
      const LoanV2 = require('../models/LoanV2');
      const loansV2 = await LoanV2.find({ clientId: id }).sort({ createdAt: -1 });
      mappedV2 = loansV2.map(l => {
        const obj = l.toObject();
        return {
          ...obj,
          _isV2: true,
          client: obj.clientId // Normalizar para el front
        };
      });
    } catch (e) { }

    const loans = [...loansV1, ...mappedV2].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Métricas
    const activeLoans = loans.filter(l => l.status === 'active');
    const paidLoans = loans.filter(l => l.status === 'paid');

    const totalBorrowed = loans.reduce((acc, l) => acc + l.amount, 0);
    const totalInterestGenerated = loans.reduce((acc, l) => {
      if (l._isV2) return acc + (l.financialModel?.interestTotal || 0);
      return acc + ((l.totalToPay || l.amount) - l.amount);
    }, 0);

    // Score Crediticio
    let creditScore = 100;
    const hasLatePayments = activeLoans.some(l => {
      const schedule = l.schedule || [];
      return schedule.some(q => new Date(q.dueDate) < new Date() && q.status === 'pending');
    });

    if (hasLatePayments) creditScore -= 20;
    if (activeLoans.length > 2) creditScore -= 10;

    res.json({
      personal: client,
      financial: {
        creditScore,
        activeLoansCount: activeLoans.length,
        paidLoansCount: paidLoans.length,
        totalDebt: client.balance,
        totalBorrowed,
        totalInterestGenerated
      },
      loans: loans
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 4. ACTUALIZAR CLIENTE
exports.updateClient = async (req, res) => {
  try {
    // Parse references if it's a string (from FormData)
    let references = req.body.references;
    if (typeof references === 'string') {
      try {
        references = JSON.parse(references);
      } catch (e) {
        // Keep existing if parse fails
      }
    }

    // Prepare update data
    const updateData = { ...req.body };
    if (references) {
      updateData.references = references;
    }

    // Sanitize ObjectId fields in update (remove empty strings)
    const objectIdFields = ['assignedTo', 'assignedInvestor', 'assignedManager', 'assignedWallet', 'createdBy'];
    objectIdFields.forEach(field => {
      if (updateData[field] === '' || updateData[field] === 'null' || updateData[field] === 'undefined') {
        // For updates, we might want to unset it or set to null?
        // Mongoose won't accept empty string for ObjectId.
        // If we want to CLEAR the assignment, we should use $unset or set to null (if schema allows).
        // Our schema allows sparse/null for some, but typically we just don't want to send empty string.
        // If the user means "No Assignment", we should probably set to null.
        // But for now, let's just delete the key if it's empty string to avoid the error.
        delete updateData[field];
      }
    });

    // Handle uploaded files
    if (req.files) {
      if (req.files.idCardFront) {
        updateData.idCardFront = `/uploads/clients/${req.files.idCardFront[0].filename}`;
      }
      if (req.files.idCardBack) {
        updateData.idCardBack = `/uploads/clients/${req.files.idCardBack[0].filename}`;
      }
      if (req.files.photo) {
        updateData.photo = `/uploads/clients/${req.files.photo[0].filename}`;
      }
    }

    // Solo actualiza si el ID coincide Y pertenece a mi negocio
    const updated = await Client.findOneAndUpdate(
      { _id: req.params.id, ...req.businessFilter },
      updateData,
      { new: true }
    );

    if (!updated) return res.status(404).json({ message: "No se pudo actualizar (Cliente no encontrado)" });

    res.json(updated);
  } catch (error) {
    console.error('Error updating client:', error);
    res.status(500).json({ error: error.message });
  }
};

// 5. ELIMINAR CLIENTE
exports.deleteClient = async (req, res) => {
  try {
    const client = await Client.findOne({ _id: req.params.id, ...req.businessFilter });

    if (!client) return res.status(404).json({ message: "Cliente no encontrado" });
    if (client.balance > 0) return res.status(400).json({ error: "No se puede borrar cliente con deuda pendiente" });

    await Client.findByIdAndDelete(req.params.id);
    res.json({ message: "Cliente eliminado correctamente" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};