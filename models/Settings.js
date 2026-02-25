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

  // Configuración de Días Laborables
  workingDays: { type: [Number], default: [1, 2, 3, 4, 5, 6] }, // 0=Dom, 1=Lun ... 6=Sab
  nonWorkingDates: { type: [Date], default: [] }, // Feriados específicos

  // Recibos
  receiptFooter: { type: String, default: 'Gracias por su pago.' },

  // Integraciones
  telegram: {
    botToken: { type: String, default: '' },
    chatId: { type: String, default: '' },
    enabled: { type: Boolean, default: false },
    schedule: { type: [String], default: ["08:00", "12:00", "17:00"] } // Horarios de resumen
  },

  // Global Revenue Share Defaults
  defaultRevenueShare: {
    investor: { type: Number, default: 45 },
    manager: { type: Number, default: 35 },
    platform: { type: Number, default: 20 }
  },

  // Módulos Activos
  enabledModules: { type: [String], default: [] }, // Lista de IDs de módulos habilitados

  // Configuración AI
  aiConfig: {
    provider: { type: String, enum: ['openai', 'gemini'], default: 'openai' },
    apiKey: { type: String, default: '' },
    enabled: { type: Boolean, default: false }
  },

  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Settings', SettingsSchema);