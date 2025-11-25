const mongoose = require('mongoose');

const ClientSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  name: { type: String, required: true },
  address: { type: String, required: true },
  phone: String,
  occupation: String,
  income: Number,
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

module.exports = mongoose.model('Client', ClientSchema);