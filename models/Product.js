const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
  name: { type: String, required: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },

  // TIPOS DE PRÉSTAMO OFICIALES
  lendingType: {
    type: String,
    enum: ['redito', 'fixed', 'amortization'],
    required: true
  },

  // Configuración Base
  interestRate: { type: Number, required: true },
  paymentFrequency: { type: String, default: 'weekly' },

  // CONFIGURACIÓN DE MORA
  penaltyType: {
    type: String,
    enum: ['percentage_quota', 'percentage_capital', 'fixed_amount'],
    default: 'percentage_quota'
  },
  penaltyValue: { type: Number, default: 5 }, // % o Monto fijo
  gracePeriod: { type: Number, default: 1 },

  isActive: { type: Boolean, default: true }
});

module.exports = mongoose.model('Product', ProductSchema);