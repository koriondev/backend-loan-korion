const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
  // Organización
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  companyName: { type: String, default: 'Mi Financiera' },
  address: { type: String, default: '' },
  phone: { type: String, default: '' },
  rnc: { type: String, default: '' }, // Identificación fiscal
  managerName: { type: String, default: '' },

  // Sistema Financiero
  currency: { type: String, default: 'DOP' },
  defaultInterest: { type: Number, default: 10 },

  // Configuración de Mora (Vital para producción)
  lateFeeType: { type: String, enum: ['percent', 'fixed'], default: 'percent' }, // % o Fijo
  lateFeeValue: { type: Number, default: 5 }, // Ej: 5%
  gracePeriod: { type: Number, default: 3 }, // Días de gracia antes de cobrar mora

  // Recibos
  receiptFooter: { type: String, default: 'Gracias por su pago.' },

  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Settings', SettingsSchema);