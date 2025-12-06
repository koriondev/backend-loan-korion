const mongoose = require('mongoose');
const Settings = require('./models/Settings');
const notificationController = require('./controllers/notificationController');
const { generateReceiptPDF } = require('./utils/pdfGenerator');
const User = require('./models/User');
require('dotenv').config();

// Mock fetch if needed, but we want to test real sending if possible.
// However, without the user's real bot token in .env (it's in DB), we rely on DB.
// We will NOT mock fetch here to see if the real call works, assuming the DB has valid credentials.
// If the user's DB has the token, it should work.

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const verifyPdfSend = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });
        if (!user) throw new Error('User not found');

        const businessId = user.businessId;
        console.log(`Testing for Business ID: ${businessId}`);

        const settings = await Settings.findOne({ businessId });
        if (!settings) throw new Error('Settings not found');

        console.log('Telegram Settings:', {
            enabled: settings.telegram.enabled,
            hasToken: !!settings.telegram.botToken,
            hasChatId: !!settings.telegram.chatId
        });

        if (!settings.telegram.enabled) {
            console.log('⚠️ Telegram is disabled in settings. Enabling temporarily for test...');
            settings.telegram.enabled = true;
            // We won't save this to avoid messing up user state if they wanted it off, 
            // but for the test we need it on.
        }

        // Mock Data
        const mockTransaction = {
            date: new Date(),
            amount: 500,
            category: 'Pago Préstamo',
            metadata: { breakdown: { capital: 400, interest: 100, mora: 0 } }
        };
        const mockClient = { name: 'Test Client', cedula: '001-0000000-1', phone: '809-555-5555' };
        const mockLoan = {
            _id: '507f1f77bcf86cd799439011',
            amount: 10000,
            balance: 5000,
            schedule: [{ status: 'paid' }, { status: 'pending' }]
        };

        console.log('--- 1. Generating PDF ---');
        const pdfBuffer = await generateReceiptPDF(mockTransaction, mockClient, mockLoan, settings);
        console.log(`PDF Generated. Size: ${pdfBuffer.length} bytes`);

        console.log('--- 2. Sending to Telegram ---');
        await notificationController.sendTelegramDocument(
            businessId,
            '📄 Prueba de Recibo PDF (Debug)',
            pdfBuffer,
            'Recibo_Prueba_Debug.pdf'
        );
        console.log('Send function called.');

        // We need to wait a bit because sendTelegramDocument is async but might not return the fetch result directly 
        // if it catches errors internally. 
        // The controller logs errors, so we should see them in stdout.

        setTimeout(() => {
            console.log('Done waiting.');
            process.exit(0);
        }, 5000);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

verifyPdfSend();
