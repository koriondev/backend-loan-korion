/**
 * SEED SCRIPT v2 — Datos de Prueba para stevend@korion.do
 * Crea (o reutiliza) 10 clientes + 20 préstamos V3 con diferentes modelos,
 * frecuencias y estados (al día, en atraso, pago hoy).
 * Uso: node seed_test_data.js
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

mongoose.connect(process.env.MONGO_URI, { dbName: 'test' }).then(async () => {
    console.log('✅ MongoDB conectado');
    const User = require('./models/User');
    const Client = require('./models/Client');
    const LoanV3 = require('./models/LoanV3');
    const Wallet = require('./models/Wallet');
    const PaymentV2 = require('./models/PaymentV2');

    // ── 1. Obtener usuario ──
    const user = await User.findOne({ email: 'stevend@korion.do' });
    if (!user) { console.error('❌ Usuario no encontrado'); process.exit(1); }
    const { businessId, _id: userId } = user;
    console.log(`👤 ${user.name} | businessId: ${businessId}`);

    // ── 2. Cartera principal ──
    const wallet = await Wallet.findOne({ businessId });
    if (!wallet) { console.error('❌ No existe ninguna cartera para este usuario'); process.exit(1); }
    const walletId = wallet._id;
    console.log(`💼 Cartera: ${wallet.name}`);

    // ── 3. Limpiar préstamos de prueba anteriores ──
    const oldClients = await Client.find({ businessId, cedula: /^00-[0-9]/ });
    if (oldClients.length) {
        const ids = oldClients.map(c => c._id);
        await LoanV3.deleteMany({ clientId: { $in: ids } });
        await Client.deleteMany({ _id: { $in: ids } });
        console.log(`🗑️  Limpié ${oldClients.length} clientes/préstamos de prueba previos`);
    }

    // ── 4. Crear 10 clientes ──
    const clientsData = [
        { firstName: 'Juan', lastName: 'Pérez García', cedula: '00-001-0001-1', phone: '809-555-0001', address: 'Calle Los Pinos #1, Santo Domingo', occupation: 'Comerciante', monthlyIncome: 35000 },
        { firstName: 'María', lastName: 'González López', cedula: '00-001-0002-2', phone: '809-555-0002', address: 'Av. Independencia #45, Santiago', occupation: 'Maestra', monthlyIncome: 28000 },
        { firstName: 'Carlos', lastName: 'Martínez Reyes', cedula: '00-001-0003-3', phone: '809-555-0003', address: 'Calle Mercedes #12, La Romana', occupation: 'Mecánico', monthlyIncome: 42000 },
        { firstName: 'Ana', lastName: 'Rodríguez Soto', cedula: '00-001-0004-4', phone: '809-555-0004', address: 'Calle Duarte #88, San Pedro de Macorís', occupation: 'Enfermera', monthlyIncome: 32000 },
        { firstName: 'Luis', lastName: 'Fernández Cruz', cedula: '00-001-0005-5', phone: '809-555-0005', address: 'Av. 27 de Febrero #200, Santo Domingo', occupation: 'Técnico electricista', monthlyIncome: 38000 },
        { firstName: 'Rosa', lastName: 'Jiménez Vargas', cedula: '00-001-0006-6', phone: '809-555-0006', address: 'Calle El Conde #15, Santo Domingo', occupation: 'Costurera', monthlyIncome: 22000 },
        { firstName: 'Miguel', lastName: 'Santos Herrera', cedula: '00-001-0007-7', phone: '809-555-0007', address: 'Calle 3, Villa Consuelo, Santo Domingo', occupation: 'Taxista', monthlyIncome: 30000 },
        { firstName: 'Carmen', lastName: 'Torres Medina', cedula: '00-001-0008-8', phone: '829-555-0008', address: 'Calle 5 #34, Los Mina, Santo Domingo', occupation: 'Vendedora', monthlyIncome: 18000 },
        { firstName: 'Roberto', lastName: 'Díaz Castillo', cedula: '00-001-0009-9', phone: '849-555-0009', address: 'Av. España #102, Higüey', occupation: 'Agricultor', monthlyIncome: 25000 },
        { firstName: 'Patricia', lastName: 'Morales Ruiz', cedula: '00-001-0010-0', phone: '809-555-0010', address: 'Calle 8 #56, Gazcue, Santo Domingo', occupation: 'Contadora', monthlyIncome: 55000 },
    ];

    const clients = [];
    for (const cd of clientsData) {
        const c = await Client.create({
            ...cd,
            name: `${cd.firstName} ${cd.lastName}`,
            businessId,
            assignedTo: userId,
            assignedWallet: walletId,
            status: 'active',
            references: [{ name: `Familiar de ${cd.firstName}`, phone: '809-000-0000', relationship: 'Familiar' }]
        });
        clients.push(c);
        console.log(`  👤 ${c.firstName} ${c.lastName}`);
    }

    // ── 5. Helpers ──
    const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
    const D = (daysAgo) => addDays(new Date('2026-02-27'), -daysAgo);
    const freqDays = { daily: 1, weekly: 7, biweekly: 15, monthly: 30 };

    // lendingType values: 'fixed' = cuota fija, 'amortization' = saldo insoluto, 'redito' = solo interés
    const loanCfgs = [
        // ────────────── AL DÍA ──────────────
        { ci: 0, lt: 'fixed', freq: 'daily', amt: 5000, rate: 10, dur: 30, ago: 15, pays: 15, label: 'Al día · Cuota Fija Diario' },
        { ci: 1, lt: 'fixed', freq: 'weekly', amt: 15000, rate: 8, dur: 12, ago: 42, pays: 6, label: 'Al día · Cuota Fija Semanal' },
        { ci: 2, lt: 'fixed', freq: 'biweekly', amt: 25000, rate: 7, dur: 12, ago: 45, pays: 3, label: 'Al día · Cuota Fija Quincenal' },
        { ci: 3, lt: 'fixed', freq: 'monthly', amt: 50000, rate: 6, dur: 12, ago: 90, pays: 3, label: 'Al día · Cuota Fija Mensual' },
        { ci: 4, lt: 'amortization', freq: 'weekly', amt: 20000, rate: 9, dur: 16, ago: 35, pays: 5, label: 'Al día · Amortizable Semanal' },
        { ci: 5, lt: 'amortization', freq: 'biweekly', amt: 30000, rate: 8, dur: 12, ago: 30, pays: 2, label: 'Al día · Amortizable Quincenal' },
        { ci: 6, lt: 'amortization', freq: 'monthly', amt: 80000, rate: 5, dur: 24, ago: 60, pays: 2, label: 'Al día · Amortizable Mensual' },
        { ci: 7, lt: 'redito', freq: 'weekly', amt: 10000, rate: 10, dur: 8, ago: 21, pays: 3, label: 'Al día · Rédito Semanal' },

        // ────────────── EN ATRASO ──────────────
        { ci: 0, lt: 'fixed', freq: 'weekly', amt: 12000, rate: 10, dur: 10, ago: 56, pays: 3, label: 'En atraso · Cuota Fija Semanal' },
        { ci: 1, lt: 'fixed', freq: 'daily', amt: 3000, rate: 12, dur: 20, ago: 10, pays: 0, label: 'En atraso · Cuota Fija Diario (sin pagos)' },
        { ci: 2, lt: 'amortization', freq: 'biweekly', amt: 40000, rate: 8, dur: 8, ago: 60, pays: 1, label: 'En atraso · Amortizable Quincenal' },
        { ci: 8, lt: 'fixed', freq: 'monthly', amt: 60000, rate: 7, dur: 6, ago: 120, pays: 2, label: 'En atraso · Cuota Fija Mensual' },
        { ci: 9, lt: 'redito', freq: 'biweekly', amt: 25000, rate: 9, dur: 12, ago: 60, pays: 1, label: 'En atraso · Rédito Quincenal' },

        // ────────────── PAGO HOY ──────────────
        { ci: 3, lt: 'fixed', freq: 'daily', amt: 8000, rate: 10, dur: 15, ago: 2, pays: 1, label: 'Pago hoy · Cuota Fija Diario' },
        { ci: 4, lt: 'fixed', freq: 'weekly', amt: 20000, rate: 8, dur: 8, ago: 7, pays: 1, label: 'Pago hoy · Cuota Fija Semanal' },
        { ci: 5, lt: 'amortization', freq: 'biweekly', amt: 35000, rate: 7, dur: 10, ago: 15, pays: 1, label: 'Pago hoy · Amortizable Quincenal' },
        { ci: 6, lt: 'amortization', freq: 'monthly', amt: 100000, rate: 5, dur: 12, ago: 30, pays: 1, label: 'Pago hoy · Amortizable Mensual' },
        { ci: 7, lt: 'redito', freq: 'weekly', amt: 15000, rate: 10, dur: 10, ago: 14, pays: 2, label: 'Pago hoy · Rédito Semanal' },
        { ci: 8, lt: 'fixed', freq: 'weekly', amt: 18000, rate: 9, dur: 12, ago: 14, pays: 2, label: 'Pago hoy · Cuota Fija Semanal 2' },
        { ci: 9, lt: 'amortization', freq: 'daily', amt: 6000, rate: 11, dur: 20, ago: 3, pays: 2, label: 'Pago hoy · Amortizable Diario' },
    ];

    let count = 0;
    for (const cfg of loanCfgs) {
        const client = clients[cfg.ci];
        const startDate = D(cfg.ago);
        const fd = freqDays[cfg.freq];
        const firstPaymentDate = addDays(startDate, fd);
        const rate = cfg.rate / 100;

        // ── Calcular cuota ──
        let cuota, totalInterest;
        if (cfg.lt === 'fixed') {
            totalInterest = cfg.amt * rate * cfg.dur;
            cuota = Math.round((cfg.amt + totalInterest) / cfg.dur);
        } else if (cfg.lt === 'amortization') {
            const r = rate;
            cuota = r === 0 ? Math.round(cfg.amt / cfg.dur)
                : Math.round(cfg.amt * (r * Math.pow(1 + r, cfg.dur)) / (Math.pow(1 + r, cfg.dur) - 1));
            totalInterest = cuota * cfg.dur - cfg.amt;
        } else { // redito
            cuota = Math.round(cfg.amt * rate);
            totalInterest = cuota * cfg.dur;
        }

        // ── Construir schedule con Decimal128 ──
        const D128 = (v) => mongoose.Types.Decimal128.fromString(String(Math.max(0, Math.round(v * 100) / 100)));
        let remCap = cfg.amt;
        const schedule = [];
        for (let i = 0; i < cfg.dur; i++) {
            const dueDate = addDays(startDate, fd * (i + 1));
            let pAmt, iAmt;
            if (cfg.lt === 'fixed') {
                iAmt = Math.round(cfg.amt * rate);
                pAmt = cuota - iAmt;
            } else if (cfg.lt === 'amortization') {
                iAmt = Math.round(remCap * rate);
                pAmt = cuota - iAmt;
                remCap = Math.max(0, remCap - pAmt);
            } else {
                iAmt = cuota;
                pAmt = i === cfg.dur - 1 ? cfg.amt : 0;
            }
            schedule.push({
                number: i + 1, dueDate,
                status: 'pending',
                amount: D128(cuota),
                principalAmount: D128(pAmt),
                interestAmount: D128(iAmt),
                balance: D128(remCap),
                paidAmount: D128(0), capitalPaid: D128(0),
                interestPaid: D128(0), penaltyPaid: D128(0),
                penaltyGenerated: D128(0),
                paidDate: null, daysOfGrace: 0
            });
        }

        // ── Crear préstamo ──
        const loan = await LoanV3.create({
            businessId, clientId: client._id, walletId,
            fundingWalletId: walletId,
            amount: cfg.amt, currentCapital: cfg.amt,
            interestRateMonthly: cfg.rate,
            interestRatePeriodic: cfg.rate,
            lendingType: cfg.lt,
            frequency: cfg.freq,
            duration: cfg.dur,
            startDate, firstPaymentDate,
            status: 'active',
            approvalStatus: 'approved',
            schedule,
            financialModel: { interestCalculationMode: 'simple' },
            penaltyConfig: { type: 'percent', value: 5, gracePeriod: 3, periodMode: 'daily', applyPerInstallment: true, applyOncePerPeriod: false, applyOn: 'quota', maxPenalty: null },
            createdBy: userId
        });

        // ── Registrar pagos ──
        let capPaid = 0, intPaid = 0;
        for (let p = 0; p < cfg.pays && p < schedule.length; p++) {
            const sch = loan.schedule[p];
            const pCap = parseFloat(sch.principalAmount?.toString() || '0');
            const pInt = parseFloat(sch.interestAmount?.toString() || '0');
            const pTotal = pCap + pInt;
            const payDate = addDays(startDate, fd * (p + 1));

            loan.schedule[p].status = 'paid';
            loan.schedule[p].paidAmount = D128(pTotal);
            loan.schedule[p].capitalPaid = D128(pCap);
            loan.schedule[p].interestPaid = D128(pInt);
            loan.schedule[p].paidDate = payDate;

            capPaid += pCap;
            intPaid += pInt;

            await PaymentV2.create({
                loanId: loan._id, clientId: client._id,
                walletId, businessId, userId,
                amount: pTotal, appliedCapital: pCap,
                appliedInterest: pInt, appliedPenalty: 0,
                date: payDate,
                receiptId: `SEED-${loan._id}-${p + 1}`
            });
        }

        loan.currentCapital = Math.max(0, cfg.amt - capPaid);
        loan.markModified('schedule');
        await loan.save();

        count++;
        console.log(`  ✅ [${count}] ${cfg.label} | ${client.firstName} | Cuota:${cuota} | Pagos:${cfg.pays}/${cfg.dur}`);
    }

    console.log(`\n🎉 SEED COMPLETADO`);
    console.log(`   Clientes: ${clients.length} | Préstamos: ${count}`);
    console.log(`   Al día: 8 | En atraso: 5 | Pago hoy: 7`);
    process.exit(0);
}).catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
