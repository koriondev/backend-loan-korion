const mongoose = require('mongoose');

const ClientSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },

  // Personal Information
  firstName: { type: String },
  lastName: { type: String },
  name: { type: String, required: false }, // Legacy/computed field for backward compatibility
  cedula: { type: String, unique: true, sparse: true }, // ID number (sparse allows nulls)

  // Contact Information
  phone: String,
  address: { type: String, required: false },

  // Photos/Documents
  idCardFront: String, // URL to front of ID card image
  idCardBack: String,  // URL to back of ID card image
  photo: String,       // URL to client photo

  // Financial/Professional
  occupation: String,
  income: Number, // Legacy field
  monthlyIncome: Number, // New detailed field

  // References
  references: [{
    name: { type: String },
    phone: { type: String },
    relationship: { type: String } // e.g., "Familiar", "Amigo", "Compañero"
  }],

  // System fields
  status: { type: String, default: 'active' },
  balance: { type: Number, default: 0 },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // El Cobrador
  visitOrder: { type: Number, default: 999 }, // Orden en la lista (1, 2, 3...)
  location: {
    lat: { type: Number, default: 18.486 }, // Coordenadas por defecto (Sto Dgo)
    lng: { type: Number, default: -69.931 }
  },
  createdAt: { type: Date, default: Date.now }
});

// Virtual field to compute full name if firstName and lastName exist
ClientSchema.virtual('fullName').get(function () {
  if (this.firstName && this.lastName) {
    return `${this.firstName} ${this.lastName}`;
  }
  return this.name;
});

// Pre-validate hook to sync name field BEFORE validation
ClientSchema.pre('validate', function (next) {
  if (this.firstName && this.lastName && !this.name) {
    this.name = `${this.firstName} ${this.lastName}`;
  }
  next();
});

module.exports = mongoose.model('Client', ClientSchema);