const mongoose = require('mongoose');
const UserActivity = require('../models/UserActivity');
const User = require('../models/User');

/**
 * Registra un pulso de actividad (heartbeat)
 * Incrementa 1 minuto si el pulso es válido
 */
exports.recordHeartbeat = async (req, res) => {
    try {
        const { id: userId, businessId } = req.user;
        if (!businessId) return res.status(200).json({ skip: true });

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const activity = await UserActivity.findOneAndUpdate(
            { userId, date: today },
            {
                $inc: { minutes: 1 },
                $set: { lastActive: new Date(), businessId }
            },
            { upsert: true, new: true }
        );

        res.json({ success: true, totalToday: activity.minutes });
    } catch (error) {
        console.error('❌ Error recordHeartbeat:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * Obtener reporte de actividad de un negocio
 */
exports.getBusinessActivity = async (req, res) => {
    try {
        const { businessId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(businessId)) {
            return res.status(400).json({ error: 'ID de negocio inválido' });
        }

        // Agrupar por usuario
        const activity = await UserActivity.aggregate([
            { $match: { businessId: new mongoose.Types.ObjectId(businessId) } },
            {
                $group: {
                    _id: '$userId',
                    totalMinutes: { $sum: '$minutes' },
                    lastActive: { $max: '$lastActive' }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'userInfo'
                }
            },
            { $unwind: { path: '$userInfo', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    userId: '$_id',
                    name: { $ifNull: ['$userInfo.name', 'Usuario Eliminado'] },
                    email: { $ifNull: ['$userInfo.email', 'N/A'] },
                    totalMinutes: 1,
                    lastActive: 1
                }
            },
            { $sort: { lastActive: -1 } }
        ]);

        res.json(activity);
    } catch (error) {
        console.error('❌ Error getBusinessActivity:', error);
        res.status(500).json({ error: error.message });
    }
};
