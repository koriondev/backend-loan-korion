const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  
  // Nuevo Rol 'ti' (Super Admin)
  role: { 
    type: String, 
    enum: ['ti', 'admin', 'collector', 'secretary'], 
    default: 'collector' 
  },
  
  // Referencia al Negocio (Obligatorio si NO es TI)
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business' },
  
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);