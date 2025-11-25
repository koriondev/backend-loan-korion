const mongoose = require('mongoose');

const WalletSchema = new mongoose.Schema({
  name: { type: String, required: true },
  balance: { type: Number, default: 0 },
  isDefault: { type: Boolean, default: false },
  
  // VINCULACIÓN SAAS
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Wallet', WalletSchema);