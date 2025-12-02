const axios = require('axios');
const mongoose = require('mongoose');
const User = require('./models/User');
const Client = require('./models/Client');
const Loan = require('./models/Loan');
const Transaction = require('./models/Transaction');
require('dotenv').config();

const API_URL = 'http://localhost:5000/api';

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const recreateLoans = async () => {
    try {
        // 1. Get user and login
        const user = await User.findOne({ email: 'duartecoronajeffrynoel@gmail.com' });
        if (!user) {
            console.error('❌ Usuario no encontrado');
            process.exit(1);
        }

        console.log(`✅ Usuario: ${user.name}`);

        // Login to get token
        const loginRes = await axios.post(`${API_URL}/auth/login`, {
            email: 'duartecoronajeffrynoel@gmail.com',
            password: '123456'
        });

        const token = loginRes.data.token;
        console.log('✅ Token obtenido\n');

        // 2. Delete all existing loans for this user
        const businessId = user.businessId;
        console.log('🗑️  Eliminando préstamos existentes...');
        const deleteResult = await Loan.deleteMany({ businessId });
        console.log(`   Eliminados: ${deleteResult.deletedCount} préstamos`);

        await Transaction.deleteMany({ businessId, type: { $in: ['out_loan', 'in_payment'] } });
        console.log('   Eliminadas transacciones relacionadas\n');

        // 3. Get clients
        const clients = await Client.find({ businessId }).limit(10);
        if (clients.length < 10) {
            console.error('❌ Se necesitan al menos 10 clientes');
            process.exit(1);
        }

        // 4. Get or create wallet
        const Wallet = require('./models/Wallet');
        let wallet = await Wallet.findOne({ businessId, isDefault: true });
        if (!wallet) {
            wallet = await Wallet.create({
                businessId,
                name: 'Caja Principal',
                balance: 1000000,
                isDefault: true
            });
            console.log('   Creada wallet por defecto\n');
        }

        const walletId = wallet._id.toString();

        console.log('📋 Creando préstamos usando API...\n');

        const headers = { Authorization: `Bearer ${token}` };

        // Helper to create date
        const createDate = (month, day = 1) => {
            const date = new Date(2025, month - 1, day); // month is 0-indexed
            return date.toISOString();
        };

        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        // Loan configurations - starting from February to November
        const loanConfigs = [
            // 1. Amortizable - February - AL DÍA (paid all)
            {
                client: clients[0]._id,
                amount: 50000,
                interestRate: 10,
                duration: 10,
                frequency: 'monthly',
                lendingType: 'amortization',
                penaltyConfig: { type: 'percent', value: 5, gracePeriod: 1 },
                startDate: createDate(2, 1),
                payQuotas: 10 // Pay all 10
            },

            // 2. Cuota Fija - March - ATRASO TOTAL (never paid)
            {
                client: clients[1]._id,
                amount: 30000,
                interestRate: 15,
                duration: 8,
                frequency: 'monthly',
                lendingType: 'fixed',
                penaltyConfig: { type: 'fixed', value: 500, gracePeriod: 0 },
                startDate: createDate(3, 1),
                payQuotas: 0 // Never paid
            },

            // 3. Amortizable - April - PARCIAL (5 of 8 paid)
            {
                client: clients[2]._id,
                amount: 20000,
                interestRate: 12,
                duration: 8,
                frequency: 'monthly',
                lendingType: 'amortization',
                penaltyConfig: { type: 'percent', value: 3, gracePeriod: 1 },
                startDate: createDate(4, 1),
                payQuotas: 5
            },

            // 4. Rédito - May - EN ATRASO (3 of 10 paid)
            {
                client: clients[3]._id,
                amount: 40000,
                interestRate: 10,
                duration: 10,
                frequency: 'monthly',
                lendingType: 'redito',
                penaltyConfig: { type: 'fixed', value: 200, gracePeriod: 0 },
                startDate: createDate(5, 1),
                payQuotas: 3
            },

            // 5. Cuota Fija - June - AL DÍA (6 of 6 paid)
            {
                client: clients[4]._id,
                amount: 25000,
                interestRate: 18,
                duration: 6,
                frequency: 'monthly',
                lendingType: 'fixed',
                penaltyConfig: { type: 'percent', value: 4, gracePeriod: 1 },
                startDate: createDate(6, 1),
                payQuotas: 6
            },

            // 6. Amortizable - July - PARCIAL (3 of 6 paid)
            {
                client: clients[5]._id,
                amount: 35000,
                interestRate: 14,
                duration: 6,
                frequency: 'monthly',
                lendingType: 'amortization',
                penaltyConfig: { type: 'fixed', value: 300, gracePeriod: 0 },
                startDate: createDate(7, 1),
                payQuotas: 3
            },

            // 7. Cuota Fija - August - AL DÍA (4 of 4 paid)
            {
                client: clients[6]._id,
                amount: 18000,
                interestRate: 16,
                duration: 4,
                frequency: 'monthly',
                lendingType: 'fixed',
                penaltyConfig: { type: 'percent', value: 2, gracePeriod: 1 },
                startDate: createDate(8, 1),
                payQuotas: 4
            },

            // 8. Rédito - September - PARCIAL (2 of 4 paid)
            {
                client: clients[7]._id,
                amount: 28000,
                interestRate: 12,
                duration: 4,
                frequency: 'monthly',
                lendingType: 'redito',
                penaltyConfig: { type: 'fixed', value: 150, gracePeriod: 0 },
                startDate: createDate(9, 1),
                payQuotas: 2
            },

            // 9. Amortizable - October - AL DÍA (2 of 2 paid)
            {
                client: clients[8]._id,
                amount: 22000,
                interestRate: 20,
                duration: 2,
                frequency: 'monthly',
                lendingType: 'amortization',
                penaltyConfig: { type: 'percent', value: 3, gracePeriod: 1 },
                startDate: createDate(10, 1),
                payQuotas: 2
            },

            // 10. Cuota Fija - November - SIN PAGOS (just created)
            {
                client: clients[9]._id,
                amount: 15000,
                interestRate: 15,
                duration: 2,
                frequency: 'monthly',
                lendingType: 'fixed',
                penaltyConfig: { type: 'percent', value: 2, gracePeriod: 1 },
                startDate: createDate(11, 1),
                payQuotas: 0
            }
        ];

        let loanCount = 0;
        let paymentCount = 0;

        for (const config of loanConfigs) {
            try {
                console.log(`${loanCount + 1}. Creando préstamo ${config.lendingType}...`);

                // Create loan via API
                const createRes = await axios.post(`${API_URL}/loans`, {
                    clientId: config.client,
                    amount: config.amount,
                    interestRate: config.interestRate,
                    duration: config.duration,
                    frequency: config.frequency,
                    lendingType: config.lendingType,
                    penaltyConfig: config.penaltyConfig,
                    walletId: null // Use default
                }, { headers });

                const loan = createRes.data;
                loanCount++;

                // Update createdAt in database to match desired start date
                await Loan.findByIdAndUpdate(loan._id, {
                    createdAt: new Date(config.startDate)
                });

                // Recalculate schedule with correct dates
                await axios.put(`${API_URL}/loans/${loan._id}/recalculate-schedule`, {
                    startDate: config.startDate
                }, { headers }).catch(() => {
                    // If endpoint doesn't exist, manually update
                    console.log('   (Actualizando fechas manualmente)');
                });

                await sleep(500); // Small delay

                // Make payments if needed
                if (config.payQuotas > 0) {
                    console.log(`   Realizando ${config.payQuotas} pagos...`);

                    // Get updated loan to see schedule
                    const loanRes = await axios.get(`${API_URL}/loans/${loan._id}`, { headers });
                    const updatedLoan = loanRes.data;

                    for (let i = 0; i < config.payQuotas && i < updatedLoan.schedule.length; i++) {
                        const quota = updatedLoan.schedule[i];

                        // Pay the quota amount
                        const paymentAmount = config.lendingType === 'redito' ? quota.interest : quota.amount;

                        await axios.post(`${API_URL}/loans/pay`, {
                            loanId: loan._id,
                            amount: paymentAmount,
                            paymentType: 'quota',
                            walletId: walletId
                        }, { headers });

                        paymentCount++;
                        await sleep(300);
                    }
                }

                console.log(`   ✅ Préstamo creado con ${config.payQuotas} pagos\n`);

            } catch (error) {
                console.error(`   ❌ Error creando préstamo:`, error.response?.data || error.message);
            }
        }

        console.log(`\n✅ Proceso completado:`);
        console.log(`   📄 ${loanCount} préstamos creados`);
        console.log(`   💰 ${paymentCount} pagos realizados`);
        console.log(`\n🔄 Ejecuta "Recalcular Atrasos" en la interfaz para actualizar moras\n`);

        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error.response?.data || error.message);
        console.error(error.stack);
        process.exit(1);
    }
};

recreateLoans();
