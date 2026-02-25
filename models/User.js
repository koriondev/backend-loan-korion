const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String },

  // Nuevo Rol 'ti' (Super Admin)
  role: {
    type: String,
    enum: ['ti', 'admin', 'collector', 'secretary', 'manager', 'investor'],
    default: 'collector'
  },
  defaultSharePercentage: { type: Number, default: 0 },

  // Referencia al Negocio (Obligatorio si NO es TI)
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business' },

  isActive: { type: Boolean, default: true },
  status: {
    type: String,
    enum: ['pending_activation', 'active', 'suspended'],
    default: 'active'
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);