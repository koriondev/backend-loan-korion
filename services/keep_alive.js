const https = require('https');

// Simple self-ping to keep the instance alive (for Render Free Tier)
// WARNING: This should only be used if within acceptable usage policy.
const keepAlive = () => {
    const url = process.env.APP_URL || 'http://localhost:5000'; // Default to localhost if not set

    // Ping every 14 minutes (render sleeps after 15)
    setInterval(() => {
        console.log('🔄 Keep-Alive Ping...');
        https.get(url, (res) => {
            console.log(`✅ Ping Status: ${res.statusCode}`);
        }).on('error', (e) => {
            console.error(`❌ Ping Error: ${e.message}`);
        });
    }, 14 * 60 * 1000);
};

module.exports = keepAlive;
