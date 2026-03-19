const mongoose = require('mongoose');

const AuditReportSchema = new mongoose.Schema({
    loanId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Loan',
        required: true
    },
    businessId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Business',
        required: true
    },
    auditedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    status: {
        type: String,
        enum: ['validated', 'discrepancy'],
        required: true
    },
    // Snapshot of the system values at the time of audit
    systemValuesSnapshot: {
        amount: Number,
        startDate: Date,
        lastPaymentDate: Date,
        lastPaymentAmount: Number,
        interestRateMonthly: Number,
        quotaAmount: Number,
        status: String,
        daysLate: Number,
        totalToSettle: Number
    },
    // User reported values (only filled if status is 'discrepancy')
    reportedValues: {
        amount: Number,
        realStartDate: Date,
        lastPaymentDate: Date,
        interestRateMonthly: Number,
        realAmountPerQuota: Number,
        status: String,
        observations: String
    },
    revisionStatus: {
        type: String,
        enum: ['pending', 'corrected'],
        default: 'pending'
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Index for quick queries
AuditReportSchema.index({ businessId: 1, revisionStatus: 1 });
AuditReportSchema.index({ loanId: 1 });

AuditReportSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('AuditReport', AuditReportSchema);
