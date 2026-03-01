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
    status: {
        type: String,
        enum: ['pending', 'partial', 'paid', 'atrasado'],
        default: 'pending'
    },
    amount: {
        type: mongoose.Schema.Types.Decimal128,
        required: true
    },
    principalAmount: {
        type: mongoose.Schema.Types.Decimal128,
        required: true
    },
    interestAmount: {
        type: mongoose.Schema.Types.Decimal128,
        required: true
    },
    balance: {
        type: mongoose.Schema.Types.Decimal128,
        required: true
    },
    // V1/V2 Backwards Compatibility
    capital: mongoose.Schema.Types.Mixed,
    interest: mongoose.Schema.Types.Mixed,
    balance_after: mongoose.Schema.Types.Mixed,
    balance_start: mongoose.Schema.Types.Mixed,

    daysOfGrace: {
        type: Number,
        default: 0
    },
    penaltyGenerated: {
        type: mongoose.Schema.Types.Decimal128,
        default: 0
    },
    capitalPaid: {
        type: mongoose.Schema.Types.Decimal128,
        default: 0
    },
    interestPaid: {
        type: mongoose.Schema.Types.Decimal128,
        default: 0
    },
    penaltyPaid: {
        type: mongoose.Schema.Types.Decimal128,
        default: 0
    },
    paidAmount: {
        type: mongoose.Schema.Types.Decimal128,
        default: 0
    },
    paidDate: {
        type: Date,
        default: null
    }
}, { _id: false });

// ═══════════════════════════════════════════════════════════════════════════
// MAIN LOAN SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

const LoanSchema = new mongoose.Schema({
    // ─────────────────────────────────────────────────────────────────────────
    // BASE LOAN FIELDS
    // ─────────────────────────────────────────────────────────────────────────
    version: {
        type: Number,
        enum: [1, 2, 3],
        default: 3
    },
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

    initialDuration: {
        type: Number,
        default: 0
    },

    frequency: {
        type: String,
        enum: ['daily', 'weekly', 'biweekly', 'monthly'],
        required: true
    },

    frequencyMode: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },

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
        ref: 'Wallet'
    },
    investorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    managerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
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
        investorPercentage: { type: Number },
        managerPercentage: { type: Number },
        platformPercentage: { type: Number }
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
// BACKWARDS COMPATIBILITY VIRTUALS
// ═══════════════════════════════════════════════════════════════════════════
LoanSchema.virtual('client').get(function () {
    return this.clientId;
}).set(function (v) {
    this.clientId = v;
});

// To ensure virtuals are included in JSON and object representations
LoanSchema.set('toJSON', { virtuals: true });
LoanSchema.set('toObject', { virtuals: true });

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════
LoanSchema.index({ businessId: 1, status: 1 });
LoanSchema.index({ clientId: 1 });
LoanSchema.index({ createdAt: -1 });

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════
LoanSchema.pre('validate', function (next) {
    if (this.schedule && this.schedule.length > 0) {
        this.schedule.forEach(item => {
            if (item.principalAmount == null && item.capital != null) {
                // Determine raw value
                let capVal = item.capital;
                if (capVal && capVal.$numberDecimal) capVal = capVal.$numberDecimal;
                item.principalAmount = mongoose.Types.Decimal128.fromString(parseFloat(capVal || 0).toFixed(2));
            }
            if (item.interestAmount == null && item.interest != null) {
                let intVal = item.interest;
                if (intVal && intVal.$numberDecimal) intVal = intVal.$numberDecimal;
                item.interestAmount = mongoose.Types.Decimal128.fromString(parseFloat(intVal || 0).toFixed(2));
            }
            if (item.balance == null && (item.balance_after != null || item.balance_start != null)) {
                let balVal = item.balance_after != null ? item.balance_after : item.balance_start;
                if (balVal && balVal.$numberDecimal) balVal = balVal.$numberDecimal;
                item.balance = mongoose.Types.Decimal128.fromString(parseFloat(balVal || 0).toFixed(2));
            }

            // Check if amount is missing but capital/interest are present
            if (item.amount == null && item.principalAmount != null && item.interestAmount != null) {
                const p = parseFloat(item.principalAmount.toString());
                const i = parseFloat(item.interestAmount.toString());
                item.amount = mongoose.Types.Decimal128.fromString((p + i).toFixed(2));
            }
        });
    }
    next();
});

LoanSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('Loan', LoanSchema);
