const mongoose = require('mongoose');
const Notification = require('./models/Notification');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
const User = require('./models/User');
const notificationController = require('./controllers/notificationController');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const verifyNotifications = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });
        const businessId = user.businessId;

        console.log('--- Testing Manual Creation ---');
        await notificationController.createNotification(businessId, 'info', 'Test Notification', null);
        console.log('Created manual notification.');

        console.log('--- Testing Fetch (and Lazy Gen) ---');
        // Mock req/res
        const req = { user: { businessId } };
        const res = {
            json: (data) => {
                console.log(`Fetched ${data.notifications.length} notifications.`);
                console.log(`Unread count: ${data.unreadCount}`);
                if (data.notifications.length > 0) {
                    console.log('Sample:', data.notifications[0]);
                }
            },
            status: (code) => ({ json: (err) => console.error('Error:', err) })
        };

        await notificationController.getNotifications(req, res);

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

verifyNotifications();
