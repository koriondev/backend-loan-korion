const mongoose = require('mongoose');
const Loan = require('../models/Loan');
const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');
const Settings = require('../models/Settings');
const aiService = require('../services/aiService');

exports.getGeneralStats = async (req, res) => {
  try {
    const businessIdStr = req.user.businessId;
    if (!businessIdStr) return res.json({});
    const businessId = new mongoose.Types.ObjectId(businessIdStr);

    // Filtro unificado para manejar tanto String como ObjectId en agregaciones
    const bizFilter = { businessId: { $in: [businessId, businessIdStr] } };

    // Fechas
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    // --- 1. MÉTRICAS DE PRÉSTAMOS (ACTIVOS) ---
    const portfolioStats = await Loan.aggregate([
      { $match: { status: { $in: ['active', 'past_due'] }, ...bizFilter } },
      {
        $group: {
          _id: null,
          // Fallback para capital: Si currentCapital es 0 o null, usamos amount (para créditos viejos)
          capitalInStreet: {
            $sum: { $cond: [{ $gt: ["$currentCapital", 0] }, "$currentCapital", { $ifNull: ["$amount", 0] }] }
          },
          // Fallback para saldo total: Si realBalance es 0 o null, usamos balance
          pendingTotal: {
            $sum: { $cond: [{ $gt: ["$realBalance", 0] }, "$realBalance", { $ifNull: ["$balance", 0] }] }
          },
          lateLoans: {
            $sum: {
              $cond: [
                {
                  $anyElementTrue: {
                    $map: {
                      input: "$schedule",
                      as: "inst",
                      in: {
                        $and: [
                          { $ne: ["$$inst.status", "paid"] },
                          { $lt: ["$$inst.dueDate", today] }
                        ]
                      }
                    }
                  }
                },
                1, 0
              ]
            }
          }
        }
      }
    ]);

    const stats = portfolioStats[0] || { capitalInStreet: 0, pendingTotal: 0, lateLoans: 0 };

    // --- 2. RENDIMIENTO REAL (HISTÓRICO DE TRANSACCIONES) ---
    const performanceStats = await Transaction.aggregate([
      { $match: { ...bizFilter, type: 'in_payment' } },
      {
        $group: {
          _id: null,
          totalInterestPaid: { $sum: { $ifNull: ["$metadata.breakdown.appliedInterest", 0] } },
          totalPenaltyPaid: { $sum: { $ifNull: ["$metadata.breakdown.appliedPenalty", 0] } },
          totalCapitalPaid: {
            $sum: {
              $cond: [
                { $gt: [{ $ifNull: ["$metadata.breakdown.appliedCapital", 0] }, 0] },
                "$metadata.breakdown.appliedCapital",
                "$amount"
              ]
            }
          }
        }
      }
    ]);

    const perf = performanceStats[0] || { totalInterestPaid: 0, totalPenaltyPaid: 0, totalCapitalPaid: 0 };
    const realGain = perf.totalInterestPaid + perf.totalPenaltyPaid;

    // --- 3. LIQUIDEZ (WALLETS) ---
    const walletStats = await Wallet.aggregate([
      { $match: { ...bizFilter } },
      { $group: { _id: null, totalLiquidity: { $sum: "$balance" } } }
    ]);
    const totalLiquidity = walletStats[0]?.totalLiquidity || 0;

    // --- 4. DATOS DEL GRÁFICO (DIFERENCIADO) ---
    const chartStats = await Transaction.aggregate([
      {
        $match: {
          ...bizFilter,
          type: 'in_payment',
          date: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
          capital: { $sum: { $ifNull: ["$metadata.breakdown.appliedCapital", "$amount"] } }, // Fallback to amount if no metadata
          interest: {
            $sum: {
              $add: [
                { $ifNull: ["$metadata.breakdown.appliedInterest", 0] },
                { $ifNull: ["$metadata.breakdown.appliedPenalty", 0] }
              ]
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const formattedChartData = [];
    const daysMap = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];

    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(today.getDate() - (6 - i));
      const dateString = d.toISOString().split('T')[0];
      const found = chartStats.find(s => s._id === dateString);

      formattedChartData.push({
        name: daysMap[d.getDay()],
        capital: found ? found.capital : 0,
        interest: found ? found.interest : 0,
        total: found ? (found.capital + found.interest) : 0
      });
    }

    // --- 5. CONTEO DE CLIENTES ---
    const clientsCount = await require('../models/Client').countDocuments({ businessId: businessIdStr });

    res.json({
      capitalInStreet: stats.capitalInStreet, // Capital en la Calle
      realGain: realGain,                     // Ganancia Real (Intereses + Moras cobrados)
      pendingTotal: stats.pendingTotal,       // Saldo Pendiente Total (Lo que falta por cobrar)
      businessValue: totalLiquidity + stats.pendingTotal, // Valor Total del Negocio
      capitalRecovered: perf.totalCapitalPaid, // Capital Recuperado (Histórico)
      lateLoans: stats.lateLoans,
      availableCapital: totalLiquidity,
      clientsCount,
      chartData: formattedChartData
    });

  } catch (error) {
    console.error('❌ Error en getGeneralStats:', error);
    res.status(500).json({ error: "Error al generar estadísticas del dashboard." });
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
      Loan.aggregate([
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
      Loan.find({ status: { $in: ['active', 'past_due'] }, businessId: businessIdStr })
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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CIERRE DE CAJA / CORTE DE PERIODO
 * ═══════════════════════════════════════════════════════════════════════════
 */
exports.getClosingReport = async (req, res) => {
  try {
    const { startDate, endDate, walletId } = req.query;
    const businessId = new mongoose.Types.ObjectId(req.user.businessId);

    if (!startDate || !endDate) {
      return res.status(400).json({ error: "Las fechas de inicio y fin son obligatorias." });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    // 1. Obtener carteras involucradas
    const walletFilter = { businessId: req.user.businessId };
    if (walletId) walletFilter._id = walletId;

    const wallets = await Wallet.find(walletFilter);
    if (wallets.length === 0) return res.status(404).json({ error: "No se encontraron carteras para este cierre." });

    const reports = [];

    for (const wallet of wallets) {
      // --- A. SALDO INICIAL (Theoretical balance at start date) ---
      const prevTransactions = await Transaction.find({
        wallet: wallet._id,
        date: { $lt: start }
      });

      const ignoreCategories = [
        'Capital de Apertura', 'Inyección de Capital', 'Ajuste de Saldo',
        'Capital Inicial', 'Apertura de Capital', 'Apertura de Cartera'
      ];

      const initialFlux = prevTransactions.reduce((acc, tx) => {
        if (ignoreCategories.includes(tx.category)) return acc;
        const amt = Number(tx.amount) || 0;
        if (['in_payment', 'entry'].includes(tx.type)) return acc + amt;
        if (['out_loan', 'exit', 'dividend_distribution'].includes(tx.type)) return acc - amt;
        return acc;
      }, 0);

      const openingBalance = (Number(wallet.initialCapital) || 0) + initialFlux;

      // --- B. AGREGACIÓN DE TRANSACCIONES EN EL PERIODO ---
      const periodStats = await Transaction.aggregate([
        {
          $match: {
            wallet: wallet._id,
            date: { $gte: start, $lte: end }
          }
        },
        {
          $group: {
            _id: "$type",
            total: { $sum: "$amount" },
            appliedCapital: { $sum: { $ifNull: ["$metadata.breakdown.appliedCapital", 0] } },
            appliedInterest: { $sum: { $ifNull: ["$metadata.breakdown.appliedInterest", 0] } },
            appliedPenalty: { $sum: { $ifNull: ["$metadata.breakdown.appliedPenalty", 0] } }
          }
        }
      ]);

      // Formatear resultados por tipo
      const getStat = (type) => periodStats.find(s => s._id === type) || { total: 0, appliedCapital: 0, appliedInterest: 0, appliedPenalty: 0 };

      const incomePayment = getStat('in_payment');
      const incomeEntry = getStat('entry');
      const outcomeLoan = getStat('out_loan');
      const outcomeExit = getStat('exit');
      const outcomeDiv = getStat('dividend_distribution');

      const totalIncomes = incomePayment.total + incomeEntry.total;
      const totalOutcomes = outcomeLoan.total + outcomeExit.total + outcomeDiv.total;
      const netFlow = totalIncomes - totalOutcomes;

      reports.push({
        walletId: wallet._id,
        walletName: wallet.name,
        currency: wallet.currency,
        periodInfo: {
          openingBalance: Math.round(openingBalance * 100) / 100,
          closingBalance: Math.round((openingBalance + netFlow) * 100) / 100,
          netFlow: Math.round(netFlow * 100) / 100
        },
        breakdown: {
          incomes: {
            total: totalIncomes,
            detail: {
              payments: incomePayment.total,
              capitalCollected: incomePayment.appliedCapital,
              interestCollected: incomePayment.appliedInterest,
              penaltiesCollected: incomePayment.appliedPenalty,
              manualEntries: incomeEntry.total
            }
          },
          outcomes: {
            total: totalOutcomes,
            detail: {
              loansGranted: outcomeLoan.total,
              expenses: outcomeExit.total,
              dividends: outcomeDiv.total
            }
          }
        }
      });
    }

    res.json({
      config: { startDate: start, endDate: end, businessId: req.user.businessId },
      wallets: reports,
      consolidated: {
        totalNetFlow: reports.reduce((acc, r) => acc + r.periodInfo.netFlow, 0),
        totalInterest: reports.reduce((acc, r) => acc + r.breakdown.incomes.detail.interestCollected, 0)
      }
    });

  } catch (error) {
    console.error("❌ Error en getClosingReport:", error);
    res.status(500).json({ error: "Error interno al generar el cierre de caja." });
  }
};