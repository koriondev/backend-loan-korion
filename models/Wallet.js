const mongoose = require('mongoose');

const WalletSchema = new mongoose.Schema({
  name: { type: String, required: true },
  balance: { type: Number, default: 0 },
  initialCapital: { type: Number, default: 0 },
  isDefault: { type: Boolean, default: false },

  // NEW: Currency support
  currency: {
    type: String,
    enum: ['DOP', 'USD', 'EUR'],
    default: 'DOP'
  },

  // NEW: Owner of the wallet
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // NEW: Wallet Type for segregation
  type: {
    type: String,
    enum: ['capital', 'earnings', 'expense'],
    default: 'capital'
  },

  // VINCULACIÓN SAAS
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Wallet', WalletSchema);