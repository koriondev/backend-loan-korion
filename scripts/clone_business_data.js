require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');
const Client = require('../models/Client');
const Loan = require('../models/Loan');
const Wallet = require('../models/Wallet');
const Business = require('../models/Business');

const SOURCE_BIZ_ID = '692635b070e60fc23382fe56';
const TARGET_BIZ_ID = '699e605cb31125334cd2ddc4';

async function cloneData() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('🟢 DB Connected');

        // 1. Fetch Source Clients
        const sourceClients = await Client.find({ businessId: SOURCE_BIZ_ID });
        console.log(`Found ${sourceClients.length} clients to clone.`);

        const clientMap = {}; // oldId -> newId

        for (const client of sourceClients) {
            const clientData = client.toObject();
            delete clientData._id;
            delete clientData.id;
            clientData.businessId = TARGET_BIZ_ID;

            // Fix empty cedula problem with unique index
            if (clientData.cedula === "") {
                clientData.cedula = null;
            }

            try {
                const newClient = new Client(clientData);
                await newClient.save();
                clientMap[client._id.toString()] = newClient._id;
            } catch (err) {
                if (err.code === 11000) {
                    console.log(`Skipping duplicate client: ${clientData.name}`);
                } else {
                    console.error(`Error cloning client ${client._id}:`, err);
                }
            }
        }
        console.log('✅ Clients cloned.');

        // 2. Fetch Target Wallets (to map loans)
        const targetWallets = await Wallet.find({ businessId: TARGET_BIZ_ID });
        if (targetWallets.length === 0) {
            console.log('⚠️ No target wallets found. Creating a default one.');
            const defaultWallet = new Wallet({
                name: 'Efectivo',
                businessId: TARGET_BIZ_ID,
                balance: 1000000,
                currency: 'DOP',
                isDefault: true
            });
            await defaultWallet.save();
            targetWallets.push(defaultWallet);
        }
        const defaultWalletId = targetWallets[0]._id;

        // 3. Fetch Source Loans
        const sourceLoans = await Loan.find({ businessId: SOURCE_BIZ_ID });
        console.log(`Found ${sourceLoans.length} loans to clone.`);

        for (const loan of sourceLoans) {
            const loanData = loan.toObject();
            const oldClientId = loan.clientId ? loan.clientId.toString() : null;

            if (oldClientId && clientMap[oldClientId]) {
                delete loanData._id;
                delete loanData.id;
                loanData.businessId = TARGET_BIZ_ID;
                loanData.clientId = clientMap[oldClientId];
                loanData.fundingWalletId = defaultWalletId;

                // Fix schedule validation
                if (loanData.schedule && Array.isArray(loanData.schedule)) {
                    loanData.schedule = loanData.schedule.map(inst => {
                        // Ensure required fields for V3
                        if (!inst.amount) inst.amount = inst.total || (parseFloat(inst.capital || 0) + parseFloat(inst.interest || 0));
                        if (!inst.principalAmount) inst.principalAmount = inst.capital || 0;
                        if (!inst.interestAmount) inst.interestAmount = inst.interest || 0;
                        if (!inst.balance) inst.balance = inst.balance_after || 0;
                        return inst;
                    });
                }

                loanData.approvalStatus = 'approved';
                loanData.status = loanData.status === 'pending_approval' ? 'active' : loanData.status;

                try {
                    const newLoan = new Loan(loanData);
                    await newLoan.save();
                } catch (err) {
                    console.error(`Error cloning loan ${loan._id}:`, err.message);
                }
            } else {
                console.log(`Skipping loan ${loan._id} because client map failed.`);
            }
        }
        console.log('✅ Loans cloned.');

        console.log('🚀 MIGRATION COMPLETED SUCCESSFULLY');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during cloning:', error);
        process.exit(1);
    }
}

cloneData();
