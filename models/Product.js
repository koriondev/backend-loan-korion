const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  
  // AHORA ES OPCIONAL (Si es null, es global)
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: false },
  
  // BANDERA PARA IDENTIFICARLOS
  isGlobal: { type: Boolean, default: false },

  // Reglas
  interestRate: { type: Number, required: true },
  duration: { type: Number, default: 12 }, 
  frequency: { type: String, default: 'weekly' },
  interestType: { type: String, enum: ['simple', 'reducing'], default: 'simple' },
  
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Product', ProductSchema);