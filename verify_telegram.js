const mongoose = require('mongoose');
const Settings = require('./models/Settings');
const notificationController = require('./controllers/notificationController');
const User = require('./models/User');
require('dotenv').config();

// Mock fetch
global.fetch = async (url, options) => {
    console.log(`[MOCK FETCH] Request to: ${url}`);
    console.log(`[MOCK FETCH] Body:`, options.body);
    return { ok: true, json: async () => ({ ok: true }) };
};

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const verifyTelegram = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });
        const businessId = user.businessId;

        console.log('--- 1. Updating Settings ---');
        let settings = await Settings.findOne({ businessId });
        if (!settings) settings = new Settings({ businessId });

        settings.telegram = {
            botToken: '123456:TEST_TOKEN',
            chatId: '987654321',
            enabled: true
        };
        await settings.save();
        console.log('Settings updated with Telegram credentials.');

        console.log('--- 2. Triggering Notification ---');
        await notificationController.createNotification(
            businessId,
            'info',
            'Test Telegram Message from Verification Script'
        );
        console.log('Notification created. Check logs for [MOCK FETCH].');

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

verifyTelegram();
