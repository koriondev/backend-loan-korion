const mongoose = require('mongoose');

const BusinessSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, unique: true, lowercase: true }, 
  
  // Datos de Contacto
  ownerName: String,
  ownerEmail: { type: String, required: true },
  phone: String,

  // --- ESTA ES LA LÍNEA QUE TE FALTA ---
  // Conecta este negocio con la colección de 'Plan'
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' }, 
  // -------------------------------------

  status: { 
    type: String, 
    enum: ['active', 'suspended', 'expired'], 
    default: 'active' 
  },

  // Guardamos una copia de los límites aquí para acceso rápido
  limits: {
    maxClients: { type: Number, default: 10 },
    maxLoans: { type: Number, default: 5 },
    maxUsers: { type: Number, default: 1 }
  },
  
  licenseExpiresAt: Date,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Business', BusinessSchema);