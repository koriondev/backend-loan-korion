// const fetch = require('node-fetch'); // Native fetch in Node 20

const API_URL = 'http://localhost:5000/api';
const EMAIL = 'ti@korion.do';
const PASSWORD = '123456';

async function test() {
    try {
        // 1. Login
        console.log('🔑 Logging in...');
        const loginRes = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: EMAIL, password: PASSWORD })
        });

        if (!loginRes.ok) {
            const err = await loginRes.text();
            throw new Error(`Login failed: ${err}`);
        }

        const loginData = await loginRes.json();
        const token = loginData.token;
        console.log('✅ Login successful. Token obtained.');

        // 2. Test Preview
        console.log('🔮 Testing Preview...');
        const payload = {
            amount: 10000,
            interestRate: 10,
            duration: 12,
            frequency: 'weekly',
            lendingType: 'redito'
        };

        const previewRes = await fetch(`${API_URL}/loans/preview`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        if (!previewRes.ok) {
            const err = await previewRes.text();
            throw new Error(`Preview failed: ${previewRes.status} ${previewRes.statusText} - ${err}`);
        }

        const previewData = await previewRes.json();
        console.log('✅ Preview successful!');
        console.log('Total to Pay:', previewData.totalToPay);
        console.log('Schedule Length:', previewData.schedule.length);
        console.log('First Item:', previewData.schedule[0]);

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

// Handle fetch availability
if (!globalThis.fetch) {
    import('node-fetch').then(module => {
        globalThis.fetch = module.default;
        test();
    }).catch(err => {
        console.log("node-fetch not found, assuming global fetch exists or running in environment without it.");
        test();
    });
} else {
    test();
}
