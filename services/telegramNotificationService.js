const axios = require('axios');
const User = require('../models/User');
const eventBus = require('../utils/eventBus');

// Ensure you set TELEGRAM_BOT_TOKEN in your .env file
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

/**
 * Sends a message via Telegram API
 * @param {String} chatId 
 * @param {String} message 
 */
const sendTelegramMessage = async (chatId, message) => {
    if (!TELEGRAM_BOT_TOKEN) {
        console.warn('Telegram notifications skipped: TELEGRAM_BOT_TOKEN is missing.');
        return;
    }

    try {
        await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML' // Enables formatting like <b>bold</b> and <i>italic</i>
        });
        console.log(`Telegram message sent to ${chatId}`);
    } catch (error) {
        console.error(`Failed to send Telegram message to ${chatId}:`, error.response?.data || error.message);
    }
};

/**
 * Listeners for System Events via EventBus.
 * These are decoupled from the main HTTP request flow.
 */
eventBus.on('payment_registered', async (eventData) => {
    try {
        const { amount, clientId, businessId, clientName, loanId } = eventData;

        // Formatear montos básicos
        const formatter = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' });
        const formattedAmount = formatter.format(amount);

        // Notify users associated with the business who have linked their Telegram
        const usersToNotify = await User.find({
            businessId: businessId,
            telegramChatId: { $ne: null }
        });

        if (usersToNotify.length === 0) return;

        const message = `✅ <b>Nuevo Pago Registrado</b>
        
👤 Cliente: <b>${clientName || 'N/A'}</b>
💰 Monto Pagado: <b>${formattedAmount}</b>
🔗 ID del Préstamo: #${loanId.toString().substring(0, 8)}`;

        const notifyPromises = usersToNotify.map(user => sendTelegramMessage(user.telegramChatId, message));
        await Promise.all(notifyPromises);

    } catch (error) {
        console.error('Error handling payment_registered event:', error);
    }
});

// Puedes agregar más eventos aquí (ej. 'loan_created', 'past_due_alert')

module.exports = {
    sendTelegramMessage
};
