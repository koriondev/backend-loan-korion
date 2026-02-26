const mongoose = require('mongoose');

const UserActivitySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    date: { type: Date, required: true }, // Truncated to day for aggregation
    minutes: { type: Number, default: 0 },
    lastActive: { type: Date, default: Date.now }
});

// Índice para búsqueda rápida por usuario y día
UserActivitySchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('UserActivity', UserActivitySchema);
