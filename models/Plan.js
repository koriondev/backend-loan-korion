const mongoose = require('mongoose');

const PlanSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true }, // ej: 'basic', 'pro'
  name: { type: String, required: true }, // ej: 'Plan Básico'
  price: { type: Number, required: true },
  currency: { type: String, default: 'USD' },
  description: String,

  // Límites Duros (El sistema bloqueará si se pasan)
  limits: {
    maxClients: { type: Number, default: 10 },   // Límite de clientes
    maxLoans: { type: Number, default: 5 },      // Préstamos activos
    maxUsers: { type: Number, default: 1 },      // Usuarios (Admin + Cobradores)
    maxRoutes: { type: Number, default: 0 },     // Rutas creadas
    maxWallets: { type: Number, default: 1 }     // Cajas
  },

  // Lista de módulos permitidos para este plan
  modulePermissions: [String],

  // Funcionalidades (Flags para activar/desactivar módulos)
  features: {
    allowWhatsapp: { type: Boolean, default: false },
    allowMaps: { type: Boolean, default: false },
    allowDocuments: { type: Boolean, default: false }, // Subir fotos/pdf
    allowExpenses: { type: Boolean, default: false },  // Módulo gastos
    allowExport: { type: Boolean, default: false }     // Exportar Excel
  },

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Plan', PlanSchema);