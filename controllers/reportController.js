const mongoose = require('mongoose');
const Loan = require('../models/Loan');
const LoanV2 = require('../models/LoanV2');
const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');
const Settings = require('../models/Settings');
const aiService = require('../services/aiService');

exports.getGeneralStats = async (req, res) => {
  try {
    const businessIdStr = req.user.businessId;
    if (!businessIdStr) return res.json({});
    const businessId = new mongoose.Types.ObjectId(businessIdStr);

    // Fechas
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    // Fechas para el gráfico (Últimos 7 días)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    // --- 1. CARTERA ACTIVA & GANANCIA (V1 & V2) ---
    const [portfolioStats, portfolioStatsV2] = await Promise.all([
      Loan.aggregate([
        { $match: { status: { $in: ['active', 'past_due'] }, businessId: businessId } },
        {
          $group: {
            _id: null,
            totalBalance: { $sum: "$balance" },
            totalCurrentCapital: { $sum: "$currentCapital" },
            totalInterest: { $sum: { $subtract: ["$totalToPay", "$amount"] } }
          }
        }
      ]),
      LoanV2.aggregate([
        { $match: { status: { $in: ['active', 'past_due'] }, businessId: businessId } },
        {
          $group: {
            _id: null,
            totalBalance: { $sum: "$realBalance" },
            totalCurrentCapital: { $sum: "$currentCapital" },
            totalInterest: { $sum: "$financialModel.interestPending" } // Ajustar según LoanV2
          }
        }
      ])
    ]);

    // --- 2. FLUJO DE CAJA MENSUAL ---
    const monthlyStats = await Transaction.aggregate([
      {
        $match: {
          businessId: businessId,
          date: { $gte: startOfMonth, $lte: endOfMonth },
          type: { $in: ['in_payment', 'out_loan'] }
        }
      },
      { $group: { _id: "$type", total: { $sum: "$amount" } } }
    ]);

    // --- 3. DATOS PARA EL GRÁFICO (SEMANAL) ---
    const chartStats = await Transaction.aggregate([
      {
        $match: {
          businessId: businessId,
          type: 'in_payment', // Solo cobros
          date: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } }, // Agrupar por día
          total: { $sum: "$amount" }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Formatear gráfico (Rellenar días vacíos con 0)
    const formattedChartData = [];
    const daysMap = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];

    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(today.getDate() - (6 - i)); // Ir 6 días atrás hasta hoy
      const dateString = d.toISOString().split('T')[0];

      // Buscar si hubo cobros ese día
      const found = chartStats.find(s => s._id === dateString);

      formattedChartData.push({
        name: daysMap[d.getDay()], // Ej: "Lun"
        cobrado: found ? found.total : 0,
        esperado: 0 // Opcional: Podrías calcular cuotas esperadas aquí
      });
    }

    // --- 4. CAPITAL DISPONIBLE & MORA ---
    const wallets = await Wallet.find({ businessId: businessIdStr });
    const defaultWallet = wallets.find(w => w.isDefault) || wallets[0];
    const totalCapital = defaultWallet ? defaultWallet.balance : 0;

    // Mora simple y Ganancia Mensual (V1 & V2)
    const [activeLoansList, activeLoansListV2] = await Promise.all([
      Loan.find({ status: { $in: ['active', 'past_due'] }, businessId: businessIdStr }),
      LoanV2.find({ status: { $in: ['active', 'past_due'] }, businessId: businessIdStr })
    ]);

    let lateCount = 0;
    let monthlyGain = 0;
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);

    // Procesar V1
    activeLoansList.forEach(l => {
      // Count late loans: Si tiene cuotas vencidas y pendientes
      if (l.schedule.some(q => new Date(q.dueDate) < today && q.status === 'pending')) lateCount++;

      // Calculate monthly gain
      l.schedule.forEach(q => {
        const dueDate = new Date(q.dueDate);
        if (dueDate >= startOfMonth && dueDate <= endOfMonth) {
          monthlyGain += (q.interest || 0);
        }
      });
    });

    // Procesar V2
    activeLoansListV2.forEach(l => {
      // En V2 ya tenemos installmentsOverdue calculado
      if (l.installmentsOverdue > 0 || l.schedule.some(q => new Date(q.dueDate) < today && q.status === 'pending')) {
        lateCount++;
      }

      // Calculate monthly gain
      l.schedule.forEach(q => {
        const dueDate = new Date(q.dueDate);
        if (dueDate >= startOfMonth && dueDate <= endOfMonth) {
          monthlyGain += (q.interest || 0);
        }
      });
    });

    // Preparar respuesta consolidada
    const p1 = portfolioStats[0] || { totalBalance: 0, totalInterest: 0, totalCurrentCapital: 0 };
    const p2 = portfolioStatsV2[0] || { totalBalance: 0, totalInterest: 0, totalCurrentCapital: 0 };

    const totalActivePortfolio = p1.totalBalance + p2.totalBalance;
    const totalActiveCapital = p1.totalCurrentCapital + p2.totalCurrentCapital;
    const totalProjectedProfit = p1.totalInterest + p2.totalInterest;

    const collectedMonth = monthlyStats.find(s => s._id === 'in_payment')?.total || 0;
    const lentMonth = monthlyStats.find(s => s._id === 'out_loan')?.total || 0;

    res.json({
      activePortfolio: totalActivePortfolio,
      activeCapital: totalActiveCapital,
      activeInterest: totalActivePortfolio - totalActiveCapital,
      projectedProfit: totalProjectedProfit,
      collectedMonth,
      lentMonth,
      lateLoans: lateCount,
      availableCapital: totalCapital,
      monthlyGain, // <--- Ganancia Mensual (Interés del mes)
      chartData: formattedChartData // <--- ESTO ES LO NUEVO PARA EL GRÁFICO
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AI REPORT SUMMARY
 * ═══════════════════════════════════════════════════════════════════════════
 */
exports.generateAISummary = async (req, res) => {
  try {
    const businessIdStr = req.user.businessId;
    if (!businessIdStr) return res.status(400).json({ error: "Contexto de negocio no encontrado." });
    const businessId = new mongoose.Types.ObjectId(businessIdStr);

    // 1. Obtener Configuración AI
    const settings = await Settings.findOne({ businessId });
    if (!settings || !settings.aiConfig || !settings.aiConfig.enabled || !settings.aiConfig.apiKey) {
      return res.status(400).json({ error: "AI no configurada. Por favor, ve a Configuración -> AI para activarla." });
    }

    // 2. Obtener Estadísticas (Misma lógica consolidada V1 & V2)
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const [portfolioStats, portfolioStatsV2] = await Promise.all([
      Loan.aggregate([
        { $match: { status: { $in: ['active', 'past_due'] }, businessId: businessId } },
        {
          $group: {
            _id: null,
            totalBalance: { $sum: "$balance" },
            totalCurrentCapital: { $sum: "$currentCapital" },
            totalInterest: { $sum: { $subtract: ["$totalToPay", "$amount"] } }
          }
        }
      ]),
      LoanV2.aggregate([
        { $match: { status: { $in: ['active', 'past_due'] }, businessId: businessId } },
        {
          $group: {
            _id: null,
            totalBalance: { $sum: "$realBalance" },
            totalCurrentCapital: { $sum: "$currentCapital" },
            totalInterest: { $sum: "$financialModel.interestPending" }
          }
        }
      ])
    ]);

    const monthlyStats = await Transaction.aggregate([
      {
        $match: {
          businessId: businessId,
          date: { $gte: startOfMonth, $lte: endOfMonth },
          type: { $in: ['in_payment', 'out_loan'] }
        }
      },
      { $group: { _id: "$type", total: { $sum: "$amount" } } }
    ]);

    const wallets = await Wallet.find({ businessId: businessIdStr });
    const defaultWallet = wallets.find(w => w.isDefault) || wallets[0];
    const totalCapital = defaultWallet ? defaultWallet.balance : 0;

    const [activeLoansList, activeLoansListV2] = await Promise.all([
      Loan.find({ status: { $in: ['active', 'past_due'] }, businessId: businessIdStr }),
      LoanV2.find({ status: { $in: ['active', 'past_due'] }, businessId: businessIdStr })
    ]);

    let lateCount = 0;
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);

    activeLoansList.forEach(l => {
      if (l.schedule.some(q => new Date(q.dueDate) < today && q.status === 'pending')) lateCount++;
    });

    activeLoansListV2.forEach(l => {
      if (l.installmentsOverdue > 0 || l.schedule.some(q => new Date(q.dueDate) < today && q.status === 'pending')) {
        lateCount++;
      }
    });

    const p1 = portfolioStats[0] || { totalBalance: 0, totalInterest: 0, totalCurrentCapital: 0 };
    const p2 = portfolioStatsV2[0] || { totalBalance: 0, totalInterest: 0, totalCurrentCapital: 0 };

    const totalActivePortfolio = p1.totalBalance + p2.totalBalance;
    const totalActiveCapital = p1.totalCurrentCapital + p2.totalCurrentCapital;
    const totalProjectedProfit = p1.totalInterest + p2.totalInterest;
    const collectedMonth = monthlyStats.find(s => s._id === 'in_payment')?.total || 0;
    const lentMonth = monthlyStats.find(s => s._id === 'out_loan')?.total || 0;

    // Función para formatear moneda en el backend
    const formatDOP = (val) => {
      return new Intl.NumberFormat('es-DO', {
        style: 'currency',
        currency: 'DOP',
        minimumFractionDigits: 2
      }).format(val || 0);
    };

    const statsForAI = {
      activePortfolio: formatDOP(totalActivePortfolio),
      activeCapital: formatDOP(totalActiveCapital),
      activeInterest: formatDOP(totalActivePortfolio - totalActiveCapital),
      projectedProfit: formatDOP(totalProjectedProfit),
      collectedMonth: formatDOP(collectedMonth),
      lentMonth: formatDOP(lentMonth),
      lateLoans: lateCount,
      availableCapital: formatDOP(totalCapital)
    };

    // 3. Llamar al servicio AI
    const summary = await aiService.generateSummary(statsForAI, settings.aiConfig);

    res.json({ summary });

  } catch (error) {
    console.error("Error en generateAISummary:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * REVENUE SHARE STATS
 * ═══════════════════════════════════════════════════════════════════════════
 */
exports.getRevenueShareStats = async (req, res) => {
  try {
    const businessId = new mongoose.Types.ObjectId(req.user.businessId);
    const { startDate, endDate, userId } = req.query;

    const matchStage = {
      businessId: businessId,
      type: 'dividend_distribution',
      date: {}
    };

    if (startDate) matchStage.date.$gte = new Date(startDate);
    if (endDate) matchStage.date.$lte = new Date(endDate);
    if (!startDate && !endDate) {
      // Default to this month
      const date = new Date();
      matchStage.date.$gte = new Date(date.getFullYear(), date.getMonth(), 1);
      matchStage.date.$lte = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    }

    // If specific user selected (Investor/Manager)
    if (userId) {
      // Find wallets owned by this user involved in dividends?
      // Actually transactions link to wallet. Let's find ownerId of wallet.
      // But Transaction schema doesn't have ownerId directly, but we saved metadata or wallet has ownerId.
      // Better: Filter by wallet.ownerId via lookup
      // Or simpler: We saved metadata.role... but not userId. 
      // We need to look up wallets owned by User.
      const userWallets = await Wallet.find({ ownerId: userId }).select('_id');
      const walletIds = userWallets.map(w => w._id);
      matchStage.wallet = { $in: walletIds };
    }

    // AGGREGATION
    const stats = await Transaction.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$category", // 'Dividendo investor', 'Dividendo manager', etc.
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 }
        }
      }
    ]);

    // DETAILED LIST
    const transactions = await Transaction.find(matchStage)
      .sort({ date: -1 })
      .populate('loan', 'schedule')
      .populate('wallet', 'name ownerId')
      .limit(100);

    // TRANSFORM FOR FRONTEND
    let totalInvestor = 0;
    let totalManager = 0;
    let totalPlatform = 0;

    stats.forEach(s => {
      if (s._id.includes('investor')) totalInvestor += s.totalAmount;
      if (s._id.includes('manager')) totalManager += s.totalAmount;
      if (s._id.includes('Plataforma')) totalPlatform += s.totalAmount;
    });

    res.json({
      summary: {
        totalInvestor,
        totalManager,
        totalPlatform,
        total: totalInvestor + totalManager + totalPlatform
      },
      breakdown: stats,
      transactions: transactions.map(t => ({
        id: t._id,
        date: t.date,
        amount: t.amount,
        category: t.category,
        description: t.description,
        walletName: t.wallet?.name || 'N/A',
        // loanId: t.loan?._id, // If needed
      }))
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};