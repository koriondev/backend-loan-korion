const mongoose = require('mongoose');
const User = require('./models/User');
const Client = require('./models/Client');
const Loan = require('./models/Loan');
const Transaction = require('./models/Transaction');
const Wallet = require('./models/Wallet');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const addTestLoans = async () => {
    try {
        const user = await User.findOne({ email: 'duartecoronajeffrynoel@gmail.com' });
        if (!user) {
            console.error('❌ Usuario no encontrado');
            process.exit(1);
        }

        const businessId = user.businessId;
        console.log(`✅ Usuario: ${user.name}`);

        // Get clients
        const clients = await Client.find({ businessId }).limit(10);
        if (clients.length < 10) {
            console.error('❌ Se necesitan al menos 10 clientes');
            process.exit(1);
        }

        // Get default wallet
        let wallet = await Wallet.findOne({ businessId, isDefault: true });
        if (!wallet) {
            console.log('⚠️  No hay wallet, creando una...');
            wallet = await Wallet.create({
                businessId,
                name: 'Caja Principal',
                balance: 1000000,
                isDefault: true
            });
        }

        console.log(`\n📋 Creando préstamos de prueba...\n`);

        const loans = [];
        const transactions = [];
        let loanIndex = 0;

        // Helper to create date in the past
        const monthsAgo = (months) => {
            const date = new Date();
            date.setMonth(date.getMonth() - months);
            return date;
        };

        const weeksAgo = (weeks) => {
            const date = new Date();
            date.setDate(date.getDate() - (weeks * 7));
            return date;
        };

        // Helper to calculate schedule
        const calculateSchedule = (amount, rate, duration, frequency, type, startDate) => {
            const schedule = [];
            let currentDate = new Date(startDate);

            const addPeriod = (date) => {
                const newDate = new Date(date);
                if (frequency === 'weekly') newDate.setDate(newDate.getDate() + 7);
                else if (frequency === 'biweekly') newDate.setDate(newDate.getDate() + 14);
                else if (frequency === 'monthly') newDate.setMonth(newDate.getMonth() + 1);
                return newDate;
            };

            if (type === 'redito') {
                const interestPerPeriod = (amount * rate / 100);
                for (let i = 0; i < duration; i++) {
                    schedule.push({
                        number: i + 1,
                        dueDate: currentDate,
                        amount: interestPerPeriod,
                        interest: interestPerPeriod,
                        capital: i === duration - 1 ? amount : 0,
                        status: 'pending',
                        paidAmount: 0
                    });
                    currentDate = addPeriod(currentDate);
                }
            } else if (type === 'fixed') {
                const totalInterest = amount * (rate / 100) * duration;
                const quotaAmount = (amount + totalInterest) / duration;
                for (let i = 0; i < duration; i++) {
                    schedule.push({
                        number: i + 1,
                        dueDate: currentDate,
                        amount: quotaAmount,
                        interest: totalInterest / duration,
                        capital: amount / duration,
                        status: 'pending',
                        paidAmount: 0
                    });
                    currentDate = addPeriod(currentDate);
                }
            } else { // amortizable
                const monthlyRate = rate / 100 / 12;
                const quotaAmount = (amount * monthlyRate * Math.pow(1 + monthlyRate, duration)) / (Math.pow(1 + monthlyRate, duration) - 1);
                let balance = amount;

                for (let i = 0; i < duration; i++) {
                    const interestPayment = balance * monthlyRate;
                    const capitalPayment = quotaAmount - interestPayment;

                    schedule.push({
                        number: i + 1,
                        dueDate: currentDate,
                        amount: quotaAmount,
                        interest: interestPayment,
                        capital: capitalPayment,
                        status: 'pending',
                        paidAmount: 0
                    });

                    balance -= capitalPayment;
                    currentDate = addPeriod(currentDate);
                }
            }

            const totalToPay = schedule.reduce((sum, q) => sum + q.amount, 0);
            return { schedule, totalToPay };
        };

        // 1. PRÉSTAMO 8 MESES ATRÁS - AL DÍA (Amortizable)
        console.log('1. Creando préstamo de 8 meses - AL DÍA...');
        const loan1Date = monthsAgo(8);
        const loan1Data = calculateSchedule(50000, 10, 8, 'monthly', 'amortization', loan1Date);
        const loan1 = {
            businessId,
            client: clients[loanIndex++]._id,
            amount: 50000,
            currentCapital: 50000,
            interestRate: 10,
            duration: 8,
            frequency: 'monthly',
            lendingType: 'amortization',
            totalToPay: loan1Data.totalToPay,
            balance: loan1Data.totalToPay,
            status: 'active',
            schedule: loan1Data.schedule,
            penaltyConfig: { type: 'percent', value: 5, gracePeriod: 1 },
            lateFee: 0,
            createdAt: loan1Date
        };

        // Mark all past quotas as paid
        const today = new Date();
        let paidCapital1 = 0;
        loan1.schedule.forEach((q, idx) => {
            if (new Date(q.dueDate) < today) {
                q.status = 'paid';
                q.paidAmount = q.amount;
                q.paidInterest = q.interest;
                q.paidCapital = q.capital;
                q.paidDate = q.dueDate;
                paidCapital1 += q.capital;
            }
        });
        loan1.balance = loan1.totalToPay - loan1.schedule.filter(q => q.status === 'paid').reduce((s, q) => s + q.paidAmount, 0);
        loans.push(loan1);

        // 2. PRÉSTAMO 6 MESES - ATRASO TOTAL (Cuota Fija, nunca pagó)
        console.log('2. Creando préstamo de 6 meses - ATRASO TOTAL...');
        const loan2Date = monthsAgo(6);
        const loan2Data = calculateSchedule(30000, 15, 6, 'monthly', 'fixed', loan2Date);
        const loan2 = {
            businessId,
            client: clients[loanIndex++]._id,
            amount: 30000,
            currentCapital: 30000,
            interestRate: 15,
            duration: 6,
            frequency: 'monthly',
            lendingType: 'fixed',
            totalToPay: loan2Data.totalToPay,
            balance: loan2Data.totalToPay,
            status: 'past_due',
            schedule: loan2Data.schedule,
            penaltyConfig: { type: 'fixed', value: 500, gracePeriod: 0 },
            lateFee: 0,
            createdAt: loan2Date
        };
        // All quotas overdue, calculate late fee
        const overdueCount2 = loan2.schedule.filter(q => new Date(q.dueDate) < today).length;
        loan2.lateFee = 500 * overdueCount2; // Fixed penalty
        loans.push(loan2);

        // 3. PRÉSTAMO SEMANAL - VARIAS PAGADAS, VARIAS EN ATRASO
        console.log('3. Creando préstamo semanal - PAGADO PARCIAL...');
        const loan3Date = weeksAgo(12);
        const loan3Data = calculateSchedule(20000, 20, 12, 'weekly', 'amortization', loan3Date);
        const loan3 = {
            businessId,
            client: clients[loanIndex++]._id,
            amount: 20000,
            currentCapital: 20000,
            interestRate: 20,
            duration: 12,
            frequency: 'weekly',
            lendingType: 'amortization',
            totalToPay: loan3Data.totalToPay,
            balance: loan3Data.totalToPay,
            status: 'past_due',
            schedule: loan3Data.schedule,
            penaltyConfig: { type: 'percent', value: 3, gracePeriod: 1 },
            lateFee: 0,
            createdAt: loan3Date
        };

        // Pay first 7 quotas, leave last 5 overdue
        let paidCapital3 = 0;
        loan3.schedule.forEach((q, idx) => {
            if (idx < 7) {
                q.status = 'paid';
                q.paidAmount = q.amount;
                q.paidInterest = q.interest;
                q.paidCapital = q.capital;
                q.paidDate = q.dueDate;
                paidCapital3 += q.capital;
            }
        });
        loan3.balance = loan3.totalToPay - loan3.schedule.filter(q => q.status === 'paid').reduce((s, q) => s + q.paidAmount, 0);
        const overdueCount3 = loan3.schedule.filter(q => q.status === 'pending' && new Date(q.dueDate) < today).length;
        if (overdueCount3 > 0) {
            // Percent penalty compounds
            let moraAcc = 0;
            loan3.schedule.filter(q => q.status === 'pending' && new Date(q.dueDate) < today).forEach(q => {
                const base = q.amount + moraAcc;
                moraAcc += base * 0.03;
            });
            loan3.lateFee = moraAcc;
        }
        loans.push(loan3);

        // 4. PRÉSTAMO RÉDITO - EN ATRASO
        console.log('4. Creando préstamo rédito - EN ATRASO...');
        const loan4Date = weeksAgo(8);
        const loan4Data = calculateSchedule(40000, 10, 8, 'weekly', 'redito', loan4Date);
        const loan4 = {
            businessId,
            client: clients[loanIndex++]._id,
            amount: 40000,
            currentCapital: 40000,
            interestRate: 10,
            duration: 8,
            frequency: 'weekly',
            lendingType: 'redito',
            totalToPay: loan4Data.totalToPay,
            balance: 40000, // Rédito balance is only capital
            status: 'past_due',
            schedule: loan4Data.schedule,
            penaltyConfig: { type: 'fixed', value: 200, gracePeriod: 0 },
            lateFee: 0,
            createdAt: loan4Date
        };

        // Pay first 3 interest payments, then stop
        loan4.schedule.forEach((q, idx) => {
            if (idx < 3) {
                q.status = 'paid';
                q.paidAmount = q.interest;
                q.paidInterest = q.interest;
                q.paidCapital = 0;
                q.paidDate = q.dueDate;
            }
        });
        const overdueCount4 = loan4.schedule.filter(q => q.status === 'pending' && new Date(q.dueDate) < today).length;
        loan4.lateFee = 200 * overdueCount4;
        loans.push(loan4);

        // 5. CUOTA FIJA - EN ATRASO
        console.log('5. Creando cuota fija - EN ATRASO...');
        const loan5Date = monthsAgo(4);
        const loan5Data = calculateSchedule(25000, 12, 6, 'monthly', 'fixed', loan5Date);
        const loan5 = {
            businessId,
            client: clients[loanIndex++]._id,
            amount: 25000,
            currentCapital: 25000,
            interestRate: 12,
            duration: 6,
            frequency: 'monthly',
            lendingType: 'fixed',
            totalToPay: loan5Data.totalToPay,
            balance: loan5Data.totalToPay,
            status: 'past_due',
            schedule: loan5Data.schedule,
            penaltyConfig: { type: 'percent', value: 4, gracePeriod: 0 },
            lateFee: 0,
            createdAt: loan5Date
        };

        // Pay first 2, overdue on rest
        let paidCapital5 = 0;
        loan5.schedule.forEach((q, idx) => {
            if (idx < 2) {
                q.status = 'paid';
                q.paidAmount = q.amount;
                q.paidInterest = q.interest;
                q.paidCapital = q.capital;
                q.paidDate = q.dueDate;
                paidCapital5 += q.capital;
            }
        });
        loan5.balance = loan5.totalToPay - loan5.schedule.filter(q => q.status === 'paid').reduce((s, q) => s + q.paidAmount, 0);
        const overdueCount5 = loan5.schedule.filter(q => q.status === 'pending' && new Date(q.dueDate) < today).length;
        if (overdueCount5 > 0) {
            let moraAcc = 0;
            loan5.schedule.filter(q => q.status === 'pending' && new Date(q.dueDate) < today).forEach(q => {
                const base = q.amount + moraAcc;
                moraAcc += base * 0.04;
            });
            loan5.lateFee = moraAcc;
        }
        loans.push(loan5);

        // 6. CUOTA FIJA - AL DÍA
        console.log('6. Creando cuota fija - AL DÍA...');
        const loan6Date = weeksAgo(4);
        const loan6Data = calculateSchedule(15000, 15, 8, 'weekly', 'fixed', loan6Date);
        const loan6 = {
            businessId,
            client: clients[loanIndex++]._id,
            amount: 15000,
            currentCapital: 15000,
            interestRate: 15,
            duration: 8,
            frequency: 'weekly',
            lendingType: 'fixed',
            totalToPay: loan6Data.totalToPay,
            balance: loan6Data.totalToPay,
            status: 'active',
            schedule: loan6Data.schedule,
            penaltyConfig: { type: 'fixed', value: 100, gracePeriod: 1 },
            lateFee: 0,
            createdAt: loan6Date
        };

        // Pay all past quotas
        let paidCapital6 = 0;
        loan6.schedule.forEach((q, idx) => {
            if (new Date(q.dueDate) < today) {
                q.status = 'paid';
                q.paidAmount = q.amount;
                q.paidInterest = q.interest;
                q.paidCapital = q.capital;
                q.paidDate = q.dueDate;
                paidCapital6 += q.capital;
            }
        });
        loan6.balance = loan6.totalToPay - loan6.schedule.filter(q => q.status === 'paid').reduce((s, q) => s + q.paidAmount, 0);
        loans.push(loan6);

        // 7. CUOTA FIJA - SIN PAGOS (nuevo)
        console.log('7. Creando cuota fija - SIN PAGOS...');
        const loan7Date = weeksAgo(2);
        const loan7Data = calculateSchedule(18000, 12, 10, 'weekly', 'fixed', loan7Date);
        const loan7 = {
            businessId,
            client: clients[loanIndex++]._id,
            amount: 18000,
            currentCapital: 18000,
            interestRate: 12,
            duration: 10,
            frequency: 'weekly',
            lendingType: 'fixed',
            totalToPay: loan7Data.totalToPay,
            balance: loan7Data.totalToPay,
            status: 'active',
            schedule: loan7Data.schedule,
            penaltyConfig: { type: 'percent', value: 2, gracePeriod: 1 },
            lateFee: 0,
            createdAt: loan7Date
        };
        // No payments, check if overdue
        const overdueCount7 = loan7.schedule.filter(q => new Date(q.dueDate) < today).length;
        if (overdueCount7 > 0) {
            loan7.status = 'past_due';
            let moraAcc = 0;
            loan7.schedule.filter(q => new Date(q.dueDate) < today).forEach(q => {
                const base = q.amount + moraAcc;
                moraAcc += base * 0.02;
            });
            loan7.lateFee = moraAcc;
        }
        loans.push(loan7);

        // 8. AMORTIZABLE - EN ATRASO
        console.log('8. Creando amortizable - EN ATRASO...');
        const loan8Date = monthsAgo(5);
        const loan8Data = calculateSchedule(35000, 18, 10, 'monthly', 'amortization', loan8Date);
        const loan8 = {
            businessId,
            client: clients[loanIndex++]._id,
            amount: 35000,
            currentCapital: 35000,
            interestRate: 18,
            duration: 10,
            frequency: 'monthly',
            lendingType: 'amortization',
            totalToPay: loan8Data.totalToPay,
            balance: loan8Data.totalToPay,
            status: 'past_due',
            schedule: loan8Data.schedule,
            penaltyConfig: { type: 'fixed', value: 300, gracePeriod: 0 },
            lateFee: 0,
            createdAt: loan8Date
        };

        // Pay first 3, overdue on rest
        let paidCapital8 = 0;
        loan8.schedule.forEach((q, idx) => {
            if (idx < 3) {
                q.status = 'paid';
                q.paidAmount = q.amount;
                q.paidInterest = q.interest;
                q.paidCapital = q.capital;
                q.paidDate = q.dueDate;
                paidCapital8 += q.capital;
            }
        });
        loan8.balance = loan8.totalToPay - loan8.schedule.filter(q => q.status === 'paid').reduce((s, q) => s + q.paidAmount, 0);
        const overdueCount8 = loan8.schedule.filter(q => q.status === 'pending' && new Date(q.dueDate) < today).length;
        loan8.lateFee = 300 * overdueCount8;
        loans.push(loan8);

        // 9. AMORTIZABLE - AL DÍA
        console.log('9. Creando amortizable - AL DÍA...');
        const loan9Date = weeksAgo(6);
        const loan9Data = calculateSchedule(22000, 14, 12, 'weekly', 'amortization', loan9Date);
        const loan9 = {
            businessId,
            client: clients[loanIndex++]._id,
            amount: 22000,
            currentCapital: 22000,
            interestRate: 14,
            duration: 12,
            frequency: 'weekly',
            lendingType: 'amortization',
            totalToPay: loan9Data.totalToPay,
            balance: loan9Data.totalToPay,
            status: 'active',
            schedule: loan9Data.schedule,
            penaltyConfig: { type: 'percent', value: 3, gracePeriod: 1 },
            lateFee: 0,
            createdAt: loan9Date
        };

        // Pay all past
        let paidCapital9 = 0;
        loan9.schedule.forEach((q, idx) => {
            if (new Date(q.dueDate) < today) {
                q.status = 'paid';
                q.paidAmount = q.amount;
                q.paidInterest = q.interest;
                q.paidCapital = q.capital;
                q.paidDate = q.dueDate;
                paidCapital9 += q.capital;
            }
        });
        loan9.balance = loan9.totalToPay - loan9.schedule.filter(q => q.status === 'paid').reduce((s, q) => s + q.paidAmount, 0);
        loans.push(loan9);

        // 10. AMORTIZABLE - SIN PAGOS
        console.log('10. Creando amortizable - SIN PAGOS...');
        const loan10Date = new Date();
        loan10Date.setDate(loan10Date.getDate() - 5);
        const loan10Data = calculateSchedule(28000, 16, 8, 'weekly', 'amortization', loan10Date);
        const loan10 = {
            businessId,
            client: clients[loanIndex++]._id,
            amount: 28000,
            currentCapital: 28000,
            interestRate: 16,
            duration: 8,
            frequency: 'weekly',
            lendingType: 'amortization',
            totalToPay: loan10Data.totalToPay,
            balance: loan10Data.totalToPay,
            status: 'active',
            schedule: loan10Data.schedule,
            penaltyConfig: { type: 'fixed', value: 150, gracePeriod: 1 },
            lateFee: 0,
            createdAt: loan10Date
        };
        // No past quotas yet
        loans.push(loan10);

        // Insert all loans
        console.log('\n💾 Guardando préstamos en base de datos...');
        const insertedLoans = await Loan.insertMany(loans);

        console.log(`\n✅ ${insertedLoans.length} préstamos creados exitosamente:\n`);
        insertedLoans.forEach((loan, idx) => {
            const client = clients.find(c => c._id.toString() === loan.client.toString());
            const paid = loan.schedule.filter(q => q.status === 'paid').length;
            const total = loan.schedule.length;
            const lateFee = loan.lateFee || 0;
            console.log(`${idx + 1}. ${loan.lendingType.padEnd(12)} | ${client.name.padEnd(25)} | ${paid}/${total} cuotas | ${loan.status.padEnd(10)} | Mora: RD$${lateFee.toFixed(2)}`);
        });

        console.log('\n✅ Proceso completado');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        console.error(error.stack);
        process.exit(1);
    }
};

addTestLoans();
