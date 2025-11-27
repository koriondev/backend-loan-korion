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

        if (!loginRes.ok) throw new Error(`Login failed: ${await loginRes.text()}`);
        const { token, user } = await loginRes.json();
        console.log('✅ Login successful.');

        // 2. Create Client (if needed, or pick first)
        const clientsRes = await fetch(`${API_URL}/clients`, { headers: { 'Authorization': `Bearer ${token}` } });
        const clients = await clientsRes.json();
        const clientId = clients[0]._id;

        // 3. Create Loan with Late Fee Config (Backdated to force overdue)
        console.log('📝 Creating Loan with Late Fee...');
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30); // Started 30 days ago

        // Manually create loan via DB or API? API doesn't allow backdating easily.
        // We'll create it normally, then use a hack or just rely on the seed data if we want to test existing.
        // Actually, let's create a new one and then we can't easily backdate via API unless we added a field.
        // But wait, I can use the "Redito" loans I seeded earlier! They have overdue payments.

        // Let's find a Late Loan from the seed
        const loansRes = await fetch(`${API_URL}/loans`, { headers: { 'Authorization': `Bearer ${token}` } });
        const loans = await loansRes.json();

        // Find a loan with status 'active' and some overdue payments (implied by seed logic)
        // The seed script created loans with 'redito' type.
        console.log("Loans found:", loans.length);
        loans.forEach(l => console.log(`- ${l.client.name} (${l.lendingType})`));

        const lateLoan = loans.find(l => l.lendingType === 'redito' && (l.client.name.includes('Atrasado') || l.client.name.includes('Juan') || l.client.name.includes('Ana')));

        if (!lateLoan) {
            console.log("❌ No late loan found from seed. Run seed-loans-redito.js first.");
            return;
        }

        console.log(`🔎 Found Late Loan: ${lateLoan._id} for ${lateLoan.client.name}`);

        // 4. Update Loan to have Penalty Config (since seed might not have set it fully or we want to test specific config)
        // The seed didn't set penaltyConfig, so we need to update it or assume defaults.
        // Let's update it via API to ensure it has the config we want to test.

        console.log('⚙️ Updating Penalty Config...');
        const updateRes = await fetch(`${API_URL}/loans/${lateLoan._id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                ...lateLoan,
                penaltyConfig: { type: 'fixed', value: 100, gracePeriod: 0 } // 100 pesos per overdue quota
            })
        });

        if (!updateRes.ok) console.log("Update failed (maybe due to payments check), continuing with existing config...");

        // 5. Check Payment Details (Should show Mora)
        console.log('💰 Checking Payment Details...');
        const detailsRes = await fetch(`${API_URL}/loans/${lateLoan._id}/payment-details`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const details = await detailsRes.json();

        console.log('--- Payment Details ---');
        console.log(`Suggested: ${details.suggestedAmount}`);
        console.log(`Breakdown:`, details.breakdown);
        console.log(`Payoff: ${details.payoffAmount}`);

        if (details.breakdown.mora > 0) {
            console.log(`✅ Late Fee Detected: ${details.breakdown.mora}`);
        } else {
            console.log(`⚠️ No Late Fee detected. Check calculation logic.`);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

test();
