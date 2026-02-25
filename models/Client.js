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
  assignedInvestor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // El Inversionista Default
  assignedManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // El Gestor Default
  assignedWallet: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet' }, // La Cartera Default
  visitOrder: { type: Number, default: 999 }, // Orden en la lista (1, 2, 3...)
  location: {
    lat: { type: Number, default: 18.486 }, // Coordenadas por defecto (Sto Dgo)
    lng: { type: Number, default: -69.931 }
  },
  managerSharePercentage: { type: Number, default: 35 },
  riskLevel: { type: String, enum: ['NEW', 'LOW', 'MEDIUM', 'HIGH'], default: 'NEW' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
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

// Method to calculate and update risk level based on loan history
ClientSchema.methods.updateRiskLevel = async function() {
  const Loan = mongoose.model('Loan');
  
  // Get all loans for this client
  const loans = await Loan.find({ client: this._id });
  
  if (loans.length === 0) {
    if (this.riskLevel !== 'NEW') {
        this.riskLevel = 'NEW';
        return this.save();
    }
    return;
  }
  
  const today = new Date();
  let hasBadDebt = false;
  let hasPastDue = false;
  let hasLateInstallments = false;
  
  loans.forEach(loan => {
    if (loan.status === 'bad_debt') hasBadDebt = true;
    if (loan.status === 'past_due') hasPastDue = true;
    
    // Check individual installments for active loans
    if (loan.status === 'active' && loan.schedule) {
       const late = loan.schedule.some(q => q.status === 'pending' && new Date(q.dueDate) < today);
       if (late) hasLateInstallments = true;
    }
  });
  
  let newRisk = 'LOW';
  if (hasBadDebt || hasPastDue) {
    newRisk = 'HIGH';
  } else if (hasLateInstallments) {
    newRisk = 'MEDIUM';
  }
  
  if (this.riskLevel !== newRisk) {
    this.riskLevel = newRisk;
    return this.save();
  }
};

module.exports = mongoose.model('Client', ClientSchema);