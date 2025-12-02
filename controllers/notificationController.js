const Notification = require('../models/Notification');
const Loan = require('../models/Loan');
const mongoose = require('mongoose');

// Helper to create notification
exports.createNotification = async (businessId, type, message, relatedId = null) => {
    try {
        const notification = new Notification({
            businessId,
            type,
            message,
            relatedId
        });
        await notification.save();
        return notification;
    } catch (error) {
        console.error('Error creating notification:', error);
    }
};

exports.getNotifications = async (req, res) => {
    try {
        const businessId = req.user.businessId;

        // --- LAZY GENERATION OF ALERTS ---
        // Check for loans due today or overdue and generate notifications if they don't exist for today
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Find active loans
        const activeLoans = await Loan.find({ businessId, status: 'active' }).populate('client');

        for (const loan of activeLoans) {
            const nextQuota = loan.schedule.find(q => q.status === 'pending');
            if (!nextQuota) continue;

            const dueDate = new Date(nextQuota.dueDate);
            const dueDateStr = dueDate.toISOString().split('T')[0];
            const todayStr = today.toISOString().split('T')[0];

            // Check Due Today
            if (dueDateStr === todayStr) {
                // Check if we already notified today for this loan
                const exists = await Notification.findOne({
                    businessId,
                    type: 'payment_due',
                    relatedId: loan._id,
                    createdAt: { $gte: today }
                });

                if (!exists) {
                    await exports.createNotification(
                        businessId,
                        'payment_due',
                        `El préstamo de ${loan.client.name} vence hoy.`,
                        loan._id
                    );
                }
            }

            // Check Overdue
            if (dueDate < today) {
                // Check if we already notified today for this loan (to avoid spamming every refresh)
                const exists = await Notification.findOne({
                    businessId,
                    type: 'overdue',
                    relatedId: loan._id,
                    createdAt: { $gte: today }
                });

                if (!exists) {
                    await exports.createNotification(
                        businessId,
                        'overdue',
                        `El préstamo de ${loan.client.name} está atrasado.`,
                        loan._id
                    );
                }
            }
        }
        // ---------------------------------

        const notifications = await Notification.find({ businessId })
            .sort({ createdAt: -1 })
            .limit(50); // Limit to last 50

        const unreadCount = await Notification.countDocuments({ businessId, read: false });

        res.json({ notifications, unreadCount });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching notifications' });
    }
};

exports.markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        await Notification.findByIdAndUpdate(id, { read: true });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error marking notification as read' });
    }
};

exports.markAllAsRead = async (req, res) => {
    try {
        const businessId = req.user.businessId;
        await Notification.updateMany({ businessId, read: false }, { read: true });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Error marking all as read' });
    }
};
