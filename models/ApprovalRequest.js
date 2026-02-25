const mongoose = require('mongoose');

const ApprovalRequestSchema = new mongoose.Schema({
    loanId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'LoanV2',
        required: true
    },
    requesterId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    walletOwnerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    requestedAmount: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    reason: { type: String }, // Optional rejection reason
    respondedAt: { type: Date },

    businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ApprovalRequest', ApprovalRequestSchema);
