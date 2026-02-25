const mongoose = require('mongoose');

// ═══════════════════════════════════════════════════════════════════════════
// SUB-SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const PenaltyConfigSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['fixed', 'percent'],
        required: true
    },
    value: {
        type: Number,
        required: true
    },
    gracePeriod: {
        type: Number,
        default: 0
    },
    periodMode: {
        type: String,
        enum: ['daily', 'weekly', 'biweekly', 'monthly'],
        default: 'daily'
    },
    applyPerInstallment: {
        type: Boolean,
        default: true
    },
    applyOncePerPeriod: {
        type: Boolean,
        default: false
    },
    applyOn: {
        type: String,
        enum: ['quota', 'capital', 'interest', 'balance'],
        default: 'quota'
    },
    maxPenalty: {
        type: Number,
        default: null
    },
    // Runtime calculated fields (not persisted to DB by default)
    calculatedPenalty: { type: Number, default: 0 },
    paidPenalty: { type: Number, default: 0 },
    pendingPenalty: { type: Number, default: 0 },
    penaltyPeriodsOverdue: { type: Number, default: 0 }
}, { _id: false });

const FrequencyConfigSchema = new mongoose.Schema({
    dailyInterval: { type: Number, default: 1 },
    weeklyInterval: { type: Number, default: 1 },
    weeklyDay: {
        type: Number,
        min: 0,
        max: 6,
        default: null
    }, // 0 = Sunday, 6 = Saturday
    biweeklyMode: {
        type: String,
        enum: ['each15', '1_16', '15_30'],
        default: 'each15'
    },
    monthlyMode: {
        type: String,
        enum: ['same_day', 'end_of_month', 'every30'],
        default: 'same_day'
    },
    fixedDays: {
        type: [Number],
        default: []
    }
}, { _id: false });

const FinancialModelSchema = new mongoose.Schema({
    interestCalculationMode: {
        type: String,
        enum: ['simple', 'compound', 'daily'],
        default: 'simple'
    },
    capitalAdvanceRule: {
        type: String,
        enum: ['allowed', 'not_allowed', 'after_interest'],
        default: 'after_interest'
    },
    allowAdvancePayments: {
        type: Boolean,
        default: true
    },
    interestTotal: { type: Number, default: 0 },
    interestPending: { type: Number, default: 0 },
    interestPaid: { type: Number, default: 0 }
}, { _id: false });

const ScheduleItemSchema = new mongoose.Schema({
    number: {
        type: Number,
        required: true
    },
    dueDate: {
        type: Date,
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    capital: {
        type: Number,
        required: true
    },
    interest: {
        type: Number,
        required: true
    },
    penaltyGenerated: {
        type: Number,
        default: 0
    },
    capitalPaid: {
        type: Number,
        default: 0
    },
    interestPaid: {
        type: Number,
        default: 0
    },
    penaltyPaid: {
        type: Number,
        default: 0
    },
    paidAmount: {
        type: Number,
        default: 0
    },
    paidDate: {
        type: Date,
        default: null
    },
    status: {
        type: String,
        enum: ['pending', 'partial', 'paid'],
        default: 'pending'
    },
    balance_start: {
        type: Number,
        default: 0
    },
    balance_after: {
        type: Number,
        default: 0
    }
}, { _id: false });

// ═══════════════════════════════════════════════════════════════════════════
// MAIN LOANV3 SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

const LoanV3Schema = new mongoose.Schema({
    // ─────────────────────────────────────────────────────────────────────────
    // BASE LOAN FIELDS
    // ─────────────────────────────────────────────────────────────────────────
    clientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Client',
        required: true
    },
    businessId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Business',
        required: true
    },
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        default: null
    },

    currency: {
        type: String,
        enum: ['DOP', 'USD', 'EUR'],
        default: 'DOP'
    },

    amount: {
        type: Number,
        required: true
    },
    currentCapital: {
        type: Number,
        required: true
    },

    interestRateMonthly: {
        type: Number,
        required: true
    },
    interestRatePeriodic: {
        type: Number,
        default: 0
    },

    lendingType: {
        type: String,
        enum: ['redito', 'fixed', 'amortization'],
        required: true
    },

    duration: {
        type: Number,
        default: 0
    },

    frequency: {
        type: String,
        enum: ['daily', 'weekly', 'biweekly', 'monthly'],
        required: true
    },

    frequencyMode: FrequencyConfigSchema,

    startDate: {
        type: Date,
        required: true
    },

    firstPaymentDate: {
        type: Date,
        required: true
    },

    gracePeriod: {
        type: Number,
        default: 0
    },

    initialPaidInstallments: {
        type: Number,
        default: 0
    },

    status: {
        type: String,
        enum: ['active', 'paid', 'past_due', 'bad_debt', 'pending_approval', 'rejected'],
        default: 'active'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // FUNDING & ATTRIBUTION
    // ─────────────────────────────────────────────────────────────────────────
    fundingWalletId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Wallet',
        required: true
    },
    investorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    managerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    approvalStatus: {
        type: String,
        enum: ['approved', 'pending_approval', 'rejected'],
        default: 'approved'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // REVENUE SHARE CONFIG (SNAPSHOT)
    // ─────────────────────────────────────────────────────────────────────────
    revenueShare: {
        investorPercentage: { type: Number, required: true },
        managerPercentage: { type: Number, required: true },
        platformPercentage: { type: Number, required: true }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // EMBEDDED CONFIGS
    // ─────────────────────────────────────────────────────────────────────────
    penaltyConfig: PenaltyConfigSchema,
    financialModel: FinancialModelSchema,

    // ─────────────────────────────────────────────────────────────────────────
    // CALCULATED FIELDS (Runtime)
    // ─────────────────────────────────────────────────────────────────────────
    daysLate: {
        type: Number,
        default: 0
    },
    periodsOverdue: {
        type: Number,
        default: 0
    },
    installmentsOverdue: {
        type: Number,
        default: 0
    },
    realBalance: {
        type: Number,
        default: 0
    },
    pendingCapital: {
        type: Number,
        default: 0
    },
    pendingInterest: {
        type: Number,
        default: 0
    },
    pendingPenalty: {
        type: Number,
        default: 0
    },

    // ─────────────────────────────────────────────────────────────────────────
    // SCHEDULE (Amortization Table)
    // ─────────────────────────────────────────────────────────────────────────
    schedule: [ScheduleItemSchema],

    // ─────────────────────────────────────────────────────────────────────────
    // METADATA
    // ─────────────────────────────────────────────────────────────────────────
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════
LoanV3Schema.index({ businessId: 1, status: 1 });
LoanV3Schema.index({ clientId: 1 });
LoanV3Schema.index({ createdAt: -1 });

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════
LoanV3Schema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('LoanV3', LoanV3Schema);
