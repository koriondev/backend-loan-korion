const mongoose = require('mongoose');

const PaymentV2Schema = new mongoose.Schema({
  // ─────────────────────────────────────────────────────────────────────────
  // PAYMENT IDENTIFICATION
  // ─────────────────────────────────────────────────────────────────────────
  loanId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Loan',
    required: true
  },

  date: {
    type: Date,
    default: Date.now
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PAYMENT AMOUNTS
  // ─────────────────────────────────────────────────────────────────────────
  amount: {
    type: Number,
    required: true
  },

  remainingPayment: {
    type: Number,
    default: 0
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PAYMENT DISTRIBUTION
  // ─────────────────────────────────────────────────────────────────────────
  appliedPenalty: {
    type: Number,
    default: 0
  },

  appliedInterest: {
    type: Number,
    default: 0
  },

  appliedCapital: {
    type: Number,
    default: 0
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PAYMENT METADATA
  // ─────────────────────────────────────────────────────────────────────────
  isAdvancePayment: {
    type: Boolean,
    default: false
  },

  otherCharges: {
    type: Number,
    default: 0
  },

  metadata: {
    type: Object,
    default: {}
  },

  paymentMethod: {
    type: String,
    enum: ['cash', 'transfer', 'card', 'check', 'other'],
    default: 'cash'
  },

  walletId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Wallet',
    required: true
  },

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  receiptId: {
    type: String,
    default: null
  },

  notes: {
    type: String,
    default: ''
  },

  // ─────────────────────────────────────────────────────────────────────────
  // BUSINESS ID (for queries)
  // ─────────────────────────────────────────────────────────────────────────
  businessId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Business',
    required: true
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════
PaymentV2Schema.index({ loanId: 1, date: -1 });
PaymentV2Schema.index({ businessId: 1, date: -1 });
PaymentV2Schema.index({ receiptId: 1 });

module.exports = mongoose.model('PaymentV2', PaymentV2Schema);
