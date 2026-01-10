const Notification = require('../models/Notification');
const Loan = require('../models/Loan');
const mongoose = require('mongoose');

const Settings = require('../models/Settings');

// Helper to send Telegram message
const sendTelegramMessage = async (businessId, message) => {
    try {
        const settings = await Settings.findOne({ businessId });
        if (settings && settings.telegram && settings.telegram.enabled && settings.telegram.botToken && settings.telegram.chatId) {

            // --- WHITELIST CHECK ---
            const whitelist = (process.env.TELEGRAM_WHITELIST || '').split(',');
            if (whitelist.length > 0 && !whitelist.includes(String(settings.telegram.chatId))) {
                console.warn(`Blocked Telegram attempt to unauthorized ChatID: ${settings.telegram.chatId}`);
                return;
            }
            // -----------------------

            const url = `https://api.telegram.org/bot${settings.telegram.botToken}/sendMessage`;
            const body = {
                chat_id: settings.telegram.chatId,
                text: message,
                parse_mode: 'Markdown'
            };

            // Usamos fetch nativo de Node 18+
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        }
    } catch (error) {
        console.error('Error sending Telegram message:', error);
    }
};

// Helper: Mask Client Name
const maskName = (name) => {
    if (!name || name.length <= 3) return name;
    const parts = name.split(' ');
    if (parts.length > 1) {
        return `${parts[0]} ${parts[1].slice(0, 1)}...`;
    }
    return `${name.slice(0, 3)}...`;
};

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

        // Send Telegram (Fire and forget)
        sendTelegramMessage(businessId, message);

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
                        `El préstamo de ${maskName(loan.client.name)} vence hoy.`,
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
                        `El préstamo de ${maskName(loan.client.name)} está atrasado.`,
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

exports.sendTestNotification = async (req, res) => {
    try {
        const businessId = req.user.businessId;
        await sendTelegramMessage(businessId, "🔔 *Prueba de Notificación*\n\nSi estás leyendo esto, ¡la integración con Telegram funciona correctamente! 🚀");
        res.json({ success: true, message: 'Mensaje de prueba enviado' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error enviando prueba' });
    }
};

exports.sendSummary = async (businessId) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // 1. Cobros del Día (Pagos realizados hoy)
        // Necesitamos buscar transacciones de tipo 'payment' creadas hoy
        // Como no tenemos modelo Transaction importado aquí, lo haremos vía Loan o importando Transaction si existiera.
        // Por simplicidad y robustez, usaremos Notification de tipo 'payment' de hoy.
        const paymentNotifs = await Notification.find({
            businessId,
            type: 'payment',
            createdAt: { $gte: today, $lt: tomorrow }
        });
        const paymentsCount = paymentNotifs.length;

        // 2. Préstamos en Atraso (Total)
        const overdueLoans = await Loan.find({ businessId, status: 'active' }).populate('client');
        let overdueCount = 0;
        let overdueList = [];

        for (const loan of overdueLoans) {
            const nextQuota = loan.schedule.find(q => q.status === 'pending');
            if (nextQuota && new Date(nextQuota.dueDate) < today) {
                overdueCount++;
                if (overdueList.length < 5) overdueList.push(`${loan.client.name} ($${nextQuota.amount})`);
            }
        }

        // 3. Cuotas para Hoy (Pendientes)
        let dueTodayCount = 0;
        for (const loan of overdueLoans) {
            const nextQuota = loan.schedule.find(q => q.status === 'pending');
            if (nextQuota) {
                const dueStr = new Date(nextQuota.dueDate).toISOString().split('T')[0];
                const todayStr = today.toISOString().split('T')[0];
                if (dueStr === todayStr) dueTodayCount++;
            }
        }

        // Construir Mensaje
        let msg = `📊 *Resumen del Sistema*\n📅 ${today.toLocaleDateString()}\n\n`;

        msg += `💰 *Cobros Hoy:* ${paymentsCount}\n`;
        msg += `⚠️ *En Atraso:* ${overdueCount}\n`;
        if (overdueCount > 0) {
            msg += `_Top 5:_\n- ${overdueList.join('\n- ')}\n`;
        }
        msg += `\n⏰ *Vencen Hoy:* ${dueTodayCount} cuotas pendientes.\n`;

        msg += `\n_Revisa el panel para más detalles._`;

        await sendTelegramMessage(businessId, msg);
        console.log(`Summary sent to business ${businessId}`);

    } catch (error) {
        console.error('Error sending summary:', error);
    }
};

exports.sendTelegramDocument = async (businessId, caption, fileBuffer, filename) => {
    try {
        const settings = await Settings.findOne({ businessId });
        if (!settings || !settings.telegram || !settings.telegram.enabled) return;

        const { botToken, chatId } = settings.telegram;
        if (!botToken || !chatId) return;

        const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
        const FormData = require('form-data');
        const form = new FormData();
        form.append('chat_id', chatId);
        form.append('caption', caption);
        form.append('document', fileBuffer, { filename: filename, contentType: 'application/pdf' });

        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
            method: 'POST',
            body: form,
            headers: form.getHeaders()
        });

        const text = await response.text();
        try {
            const data = JSON.parse(text);
            if (!data.ok) {
                console.error('Telegram API Error (Document):', data);
            } else {
                console.log('📄 Telegram document sent:', filename);
            }
        } catch (e) {
            console.error('Error parsing Telegram response:', text);
        }
    } catch (error) {
        console.error('Error sending Telegram document:', error);
    }
};
