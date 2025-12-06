const cron = require('node-cron');
const Settings = require('../models/Settings');
const notificationController = require('../controllers/notificationController');

const initScheduler = () => {
    console.log('⏰ Scheduler Service Initialized');

    // Run every minute to check for scheduled summaries
    cron.schedule('* * * * *', async () => {
        try {
            const now = new Date();
            // Format current time as HH:MM (e.g., "06:00", "17:00")
            const currentTime = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

            // Find businesses with Telegram enabled and schedule matching current time
            const settingsList = await Settings.find({
                'telegram.enabled': true,
                'telegram.schedule': currentTime
            });

            if (settingsList.length > 0) {
                console.log(`📢 Sending summaries for ${settingsList.length} businesses at ${currentTime}`);
                for (const settings of settingsList) {
                    await notificationController.sendSummary(settings.businessId);
                }
            }
        } catch (error) {
            console.error('❌ Scheduler Error:', error);
        }
    });
};

module.exports = initScheduler;
