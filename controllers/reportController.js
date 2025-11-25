const mongoose = require('mongoose');
const Loan = require('../models/Loan');
const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');

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

    // --- 1. CARTERA ACTIVA & GANANCIA ---
    const portfolioStats = await Loan.aggregate([
      { $match: { status: 'active', businessId: businessId } },
      {
        $group: {
          _id: null,
          totalBalance: { $sum: "$balance" },
          // Ganancia = Total a Pagar - Monto Prestado
          totalInterest: { $sum: { $subtract: ["$totalToPay", "$amount"] } }
        }
      }
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

    // Mora simple
    const activeLoansList = await Loan.find({ status: 'active', businessId: businessIdStr });
    let lateCount = 0;
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);

    activeLoansList.forEach(l => {
      if (l.schedule.some(q => new Date(q.dueDate) < todayMidnight && q.status === 'pending')) lateCount++;
    });

    // Preparar respuesta
    const pStats = portfolioStats[0] || { totalBalance: 0, totalInterest: 0 };
    const collectedMonth = monthlyStats.find(s => s._id === 'in_payment')?.total || 0;
    const lentMonth = monthlyStats.find(s => s._id === 'out_loan')?.total || 0;

    res.json({
      activePortfolio: pStats.totalBalance,
      projectedProfit: pStats.totalInterest,
      collectedMonth,
      lentMonth,
      lateLoans: lateCount,
      availableCapital: totalCapital,
      chartData: formattedChartData // <--- ESTO ES LO NUEVO PARA EL GRÁFICO
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};