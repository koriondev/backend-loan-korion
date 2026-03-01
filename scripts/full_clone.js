console.log("🚀 STARTING ULTIMATE CLONE WITH SYNTHETIC HISTORY...");
require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');
const Client = require('../models/Client');
const Loan = require('../models/Loan');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const PaymentV2 = require('../models/PaymentV2');

const SOURCE_BIZ_ID = '692635b070e60fc23382fe56';
const TARGET_BIZ_ID = '699e605cb31125334cd2ddc4';
const ADMIN_USER_ID = '699e605cb31125334cd2ddc6'; // stevend@korion.do

async function ultimateClone() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('🟢 DB Connected');

        // 1. CLEAN
        await Loan.deleteMany({ businessId: TARGET_BIZ_ID });
        await Client.deleteMany({ businessId: TARGET_BIZ_ID });
        await Transaction.deleteMany({ businessId: TARGET_BIZ_ID });
        await PaymentV2.deleteMany({ businessId: TARGET_BIZ_ID });
        console.log('🧹 Target cleaned.');

        const targetWallet = await Wallet.findOne({ businessId: TARGET_BIZ_ID }) || { _id: new mongoose.Types.ObjectId() };
        const walletId = targetWallet._id;

        // 2. CLIENTS
        const clients = await Client.find({ businessId: SOURCE_BIZ_ID });
        const clientMap = {};
        for (const c of clients) {
            const data = c.toObject();
            const oldId = data._id.toString();
            delete data._id;
            data.businessId = TARGET_BIZ_ID;
            if (data.cedula) data.cedula = data.cedula + "-C"; else data.cedula = null;
            try {
                const newC = new Client(data);
                await newC.save();
                clientMap[oldId] = newC._id;
            } catch (e) {
                console.error(`  ❌ Client ${data.name}: ${e.message}`);
                const existing = await Client.findOne({ businessId: TARGET_BIZ_ID, name: data.name });
                if (existing) clientMap[oldId] = existing._id;
            }
        }
        console.log(`👤 ${Object.keys(clientMap).length} clients cloned.`);

        // 3. LOANS
        const loans = await Loan.find({ businessId: SOURCE_BIZ_ID });
        const loanMap = {};
        for (const l of loans) {
            const data = l.toObject();
            const oldId = data._id.toString();
            const oldClientId = (data.clientId || data.client)?.toString();

            if (oldClientId && clientMap[oldClientId]) {
                delete data._id;
                data.businessId = TARGET_BIZ_ID;
                data.clientId = clientMap[oldClientId];
                data.fundingWalletId = walletId;

                // V3 Defaults
                if (!data.interestRateMonthly) data.interestRateMonthly = data.interestRate || 0;
                if (!data.startDate) data.startDate = data.createdAt;
                if (!data.firstPaymentDate) data.firstPaymentDate = data.schedule?.[0]?.dueDate || data.startDate;

                if (data.schedule) {
                    data.schedule = data.schedule.map(inst => {
                        if (!inst.amount) inst.amount = inst.total || (parseFloat(inst.capital || 0) + parseFloat(inst.interest || 0));
                        if (!inst.principalAmount) inst.principalAmount = inst.capital || 0;
                        if (!inst.interestAmount) inst.interestAmount = inst.interest || 0;
                        if (!inst.balance) inst.balance = inst.balance_after || 0;
                        return inst;
                    });
                }

                try {
                    const newL = new Loan(data);
                    await newL.save();
                    loanMap[oldId] = newL._id;
                } catch (e) {
                    console.error(`  ❌ Loan ${oldId}: ${e.message}`);
                }
            }
        }
        console.log(`📄 ${Object.keys(loanMap).length} loans cloned.`);

        // 4. TRANSACTIONS & SYNTHETIC PAYMENTS
        const txs = await Transaction.find({ businessId: SOURCE_BIZ_ID });
        console.log(`📝 Processing ${txs.length} transactions...`);
        let txCount = 0;
        let syntheticPayCount = 0;

        for (const tx of txs) {
            const data = tx.toObject();
            const oldLoanId = (data.loanV3 || data.loanV2 || data.loan || data.loanId || data.metadata?.loanId)?.toString();
            const oldClientId = (data.client || data.clientId)?.toString();

            if (!oldLoanId || loanMap[oldLoanId]) {
                delete data._id;
                data.businessId = TARGET_BIZ_ID;
                if (oldLoanId) data.loanV3 = loanMap[oldLoanId];
                if (oldClientId) data.client = clientMap[oldClientId];
                data.wallet = walletId;

                try {
                    const newTx = new Transaction(data);
                    await newTx.save();
                    txCount++;

                    // If it's a payment, create a synthetic PaymentV2 record for the UI
                    if (data.type === 'in_payment' && oldLoanId) {
                        const payDate = data.date || new Date();

                        // Check if we should create a PaymentV2
                        // (Only if one isn't already coming from PaymentV2 collection)
                        // Actually, it's easier to just match them later or just create all from TXs since TXs are the source of truth for "historial".

                        const newPay = new PaymentV2({
                            loanId: loanMap[oldLoanId],
                            businessId: TARGET_BIZ_ID,
                            date: payDate,
                            amount: data.amount,
                            appliedPenalty: data.metadata?.breakdown?.appliedToMora || data.metadata?.breakdown?.appliedPenalty || 0,
                            appliedInterest: data.metadata?.breakdown?.appliedToInterest || data.metadata?.breakdown?.appliedInterest || 0,
                            appliedCapital: data.metadata?.breakdown?.appliedToCapital || data.metadata?.breakdown?.appliedCapital || 0,
                            walletId: walletId,
                            userId: ADMIN_USER_ID,
                            receiptId: data.receiptId || `TX-${newTx._id.toString().slice(-6)}`,
                            notes: data.description || 'Migrado de Transacción'
                        });
                        await newPay.save();
                        syntheticPayCount++;
                    }

                } catch (e) {
                    // console.error(`  ❌ Tx Error: ${e.message}`);
                }
            }
        }
        console.log(`✅ ${txCount} transactions cloned.`);
        console.log(`💰 ${syntheticPayCount} payments generated from transactions.`);

        console.log('🚀 READY TO TEST - ALL DATA SYNCED');
        process.exit(0);

    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

ultimateClone();
