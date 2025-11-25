const mongoose = require('mongoose');

const LoanSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  amount: { type: Number, required: true }, // Monto prestado
  interestRate: { type: Number, required: true }, // % de interés
  duration: { type: Number, required: true }, // Número de cuotas
  frequency: { 
    type: String, 
    enum: ['daily', 'weekly', 'biweekly', 'monthly'], 
    required: true 
  },
  lateFee: { type: Number, default: 0 }, // % de mora por cuota vencida
  type: { type: String, enum: ['simple', 'french'], default: 'simple' },
  
  // Estado del préstamo
  status: { type: String, enum: ['active', 'paid', 'bad_debt'], default: 'active' },
  
  // Control financiero
  totalToPay: { type: Number, required: true }, // Total con intereses
  balance: { type: Number, required: true }, // Lo que falta por pagar
  
  // Tabla de Amortización (Las cuotas generadas)
  schedule: [{
    number: Number,
    dueDate: Date,
    amount: Number, // Cuota total
    capital: Number, // Parte que va al capital
    interest: Number, // Parte que es ganancia
    status: { type: String, enum: ['pending', 'paid', 'partial'], default: 'pending' },
    paidAmount: { type: Number, default: 0 },
    paidDate: Date
  }],

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Loan', LoanSchema);