const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  type: {
    type: String,
    enum: ['in_payment', 'out_loan', 'entry', 'exit'],
    required: true
  },
  category: String, // Ej: "Pago Combustible"
  amount: { type: Number, required: true },
  description: String,
  receiptId: String, // <--- Added receiptId

  metadata: { type: mongoose.Schema.Types.Mixed }, // Para guardar loanId, breakdown, etc.

  // RELACIONES
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' }, // Opcional (si es cobro)
  loan: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan' }, // <--- Added this
  wallet: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', required: true }, // <--- ¡ESTO FALTABA!

  date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', TransactionSchema);