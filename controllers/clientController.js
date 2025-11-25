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

    // Creamos el cliente asignándole el ID del negocio automáticamente
    const newClient = new Client({
      ...req.body,
      businessId: businessId // <--- AQUÍ ESTÁ LA CLAVE SAAS
    });

    const savedClient = await newClient.save();
    res.status(201).json(savedClient);
  } catch (error) {
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
    const loans = await Loan.find({ client: id }).sort({ createdAt: -1 });

    // Métricas
    const activeLoans = loans.filter(l => l.status === 'active');
    const paidLoans = loans.filter(l => l.status === 'paid');
    
    const totalBorrowed = loans.reduce((acc, l) => acc + l.amount, 0);
    const totalInterestGenerated = loans.reduce((acc, l) => acc + (l.totalToPay - l.amount), 0);
    
    // Score Crediticio
    let creditScore = 100;
    const hasLatePayments = activeLoans.some(l => 
        l.schedule.some(q => new Date(q.dueDate) < new Date() && q.status === 'pending')
    );
    
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
    // Solo actualiza si el ID coincide Y pertenece a mi negocio
    const updated = await Client.findOneAndUpdate(
      { _id: req.params.id, ...req.businessFilter }, 
      req.body, 
      { new: true }
    );
    
    if (!updated) return res.status(404).json({ message: "No se pudo actualizar (Cliente no encontrado)" });
    
    res.json(updated);
  } catch (error) { 
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