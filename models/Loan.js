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

  status: { type: String, enum: ['active', 'paid', 'bad_debt', 'past_due', 'pending_approval', 'rejected'], default: 'active' },
  approvalStatus: { type: String, enum: ['approved', 'pending'], default: 'approved' },

  // Fondeo y Reparto
  fundingWallet: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet' },
  investorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  revenueShare: {
    investorPercentage: { type: Number, default: 45 },
    managerPercentage: { type: Number, default: 35 },
    platformPercentage: { type: Number, default: 20 }
  },

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

LoanSchema.post('save', async function (doc) {
  try {
    const Client = mongoose.model('Client');
    const client = await Client.findById(doc.client);
    if (client) {
      await client.updateRiskLevel();
    }
  } catch (err) {
    console.error('Error updating client risk level:', err);
  }
});

module.exports = mongoose.model('Loan', LoanSchema);