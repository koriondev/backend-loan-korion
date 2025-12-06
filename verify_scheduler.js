const mongoose = require('mongoose');
const Settings = require('./models/Settings');
const notificationController = require('./controllers/notificationController');
const User = require('./models/User');
require('dotenv').config();

// Mock fetch
global.fetch = async (url, options) => {
  console.log(`[MOCK FETCH] Request to: ${url}`);
  if (options.body) {
    const body = JSON.parse(options.body);
    console.log(`[MOCK FETCH] Message: ${body.text}`);
  }
  return { ok: true, json: async () => ({ ok: true }) };
};

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
  .then(() => console.log('✅ MongoDB conectado'))
  .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const verifyScheduler = async () => {
  try {
    const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });
    const businessId = user.businessId;

    console.log('--- Testing Summary Generation ---');
    // Force send summary
    await notificationController.sendSummary(businessId);

    console.log('Summary generation triggered. Check logs for [MOCK FETCH].');

    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

verifyScheduler();
