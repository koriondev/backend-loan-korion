const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    type: {
        type: String,
        enum: ['payment', 'loan_approved', 'payment_due', 'overdue', 'info', 'approval_request'],
        required: true
    },
    message: { type: String, required: true },
    read: { type: Boolean, default: false },
    relatedId: { type: mongoose.Schema.Types.ObjectId }, // ID of Loan or Transaction
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Notification', NotificationSchema);
