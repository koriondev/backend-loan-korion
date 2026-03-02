const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware'); // O algún middleware equivalente
const axios = require('axios');

// En .env deberías tener:
// TELEGRAM_BOT_USERNAME=KorionBot
// TELEGRAM_BOT_TOKEN=1234:ABCD
const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'tu_bot_aqui';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

/**
 * GET /api/telegram/generate-link
 * Genera un token único y temporal para vincular la cuenta.
 */
router.get('/generate-link', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id || req.user._id;

        // Generar token corto y limpio
        const token = crypto.randomBytes(8).toString('hex');
        const expirationDate = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos a futuro

        // Guardar token temporal en el usuario actual
        await User.findByIdAndUpdate(userId, {
            $set: {
                telegramAuthToken: token,
                telegramAuthExpires: expirationDate
            }
        });

        // Crear la URL estilo Deep-Link (Ej: https://t.me/KorionBot?start=ABCD...)
        const telegramLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${token}`;

        return res.json({
            success: true,
            telegramLink,
            expiresInMinutes: 10
        });

    } catch (error) {
        console.error('Error in /generate-link:', error);
        res.status(500).json({ error: 'Error generando enlace de Telegram' });
    }
});

/**
 * POST /api/telegram/webhook
 * Webhook público que escucha mensajes enviados al bot.
 */
router.post('/webhook', async (req, res) => {
    try {
        // En Telegram Webhook, siempre responde Status 200 inmediatamente
        res.status(200).send('OK');

        const update = req.body;

        // Verificamos si es un mensaje de texto
        if (!update || !update.message || !update.message.text) {
            return;
        }

        const chatId = update.message.chat.id;
        const text = update.message.text.trim(); // Ej: "/start abcdef123"

        console.log(`[Telegram Webhook] Received from ${chatId}: "${text}"`);

        if (text.startsWith('/start ')) {
            const token = text.split(' ')[1]; // Extraer token
            console.log(`[Telegram Webhook] Attempting link with token: ${token}`);

            if (!token) {
                console.log(`[Telegram Webhook] No token found in /start command`);
                return;
            }

            // Buscar si hay un usuario con ese token activo que no haya expirado
            const user = await User.findOne({
                telegramAuthToken: token,
                telegramAuthExpires: { $gt: new Date() } // Mayor a "ahora"
            });

            if (!user) {
                console.log(`[Telegram Webhook] Token ${token} NOT found or expired.`);
                await sendTelegramDirectMessage(chatId, "❌ <b>Error:</b> Token de vinculación no encontrado o expirado. Genera uno nuevo en Korion y vuelve a intentarlo.");
                return;
            }

            console.log(`[Telegram Webhook] SUCCESS! Linking user ${user.name} (${user.email}) to ChatID ${chatId}`);

            // Match exitoso: Limpiamos token y asignamos Chat ID permanentemente
            user.telegramChatId = chatId.toString();
            user.telegramAuthToken = null;
            user.telegramAuthExpires = null;
            await user.save();

            // Desacoplar respuesta exitosa al usuario final vía API
            await sendTelegramDirectMessage(chatId, `✅ <b>Cuenta vinculada con éxito</b>, ${user.name}.\n\nYa estás suscrito en tiempo real a las alertas de Korion para tu empresa. 🎉`);
        } else if (text === '/start') {
            console.log(`[Telegram Webhook] Simple /start received (no token)`);
            await sendTelegramDirectMessage(chatId, "👋 ¡Hola! Para vincular tu cuenta, por favor usa el botón 'Vincular Telegram' desde el panel de Configuración en Korion.");
        }

    } catch (error) {
        console.error('Error en /webhook /start auth flow:', error);
        // Aun en catch, Telegram recomienda 200 para no hacer retry loops infinitos
        // Pero no devolver res.status aquí ya que ya lo enviamos al principio (express err: headers sent)
    }
});

/**
 * Mini-Función de rescate para enviar mensajes iniciales (El servicio original hace algo similar)
 */
async function sendTelegramDirectMessage(chatId, message) {
    if (!TELEGRAM_BOT_TOKEN) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
        });
    } catch (e) {
        console.error(`Webhook Telegram Error enviando a ${chatId}:`, e.message);
    }
}

module.exports = router;
