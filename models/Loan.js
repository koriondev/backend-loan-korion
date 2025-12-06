const mongoose = require('mongoose');

const LoanSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, // Referencia

  // Datos Financieros
  amount: { type: Number, required: true }, // Capital Inicial
  currentCapital: { type: Number, required: true }, // Capital Actual (Base de cálculo)
  interestRate: { type: Number, required: true },

  // Lógica Rédito (Regla de los 1000)
  accumulatedCapitalAbone: { type: Number, default: 0 }, // "La alcancía" para juntar los 1000
  paidLateFee: { type: Number, default: 0 }, // Mora pagada acumulada

  duration: { type: Number, default: 0 }, // 0 = Indefinido (Rédito)
  frequency: { type: String, required: true },
  lendingType: { type: String, enum: ['redito', 'fixed', 'amortization'], required: true },

  // Totales
  totalToPay: { type: Number },
  balance: { type: Number },

  // Configuración Mora (Heredada del producto al crear)
  penaltyConfig: {
    type: { type: String, enum: ['percent', 'fixed'] },
    value: { type: Number },
    gracePeriod: { type: Number }
  },

  status: { type: String, enum: ['active', 'paid', 'bad_debt', 'past_due'], default: 'active' },

  schedule: [{
    number: Number,
    dueDate: Date,
    amount: Number, // Cuota Total Esperada
    capital: Number,
    interest: Number,
    status: { type: String, default: 'pending' },
    paidAmount: { type: Number, default: 0 },
    paidInterest: { type: Number, default: 0 },
    paidCapital: { type: Number, default: 0 },
    paidDate: Date
  }],

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Loan', LoanSchema);