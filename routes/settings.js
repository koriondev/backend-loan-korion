const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const Loan = require('../models/Loan');
const authMiddleware = require('../middleware/authMiddleware');

// Proteger rutas
router.use(authMiddleware);

// 1. OBTENER CONFIGURACIÓN (De mi empresa)
router.get('/', async (req, res) => {
  try {
    const businessId = req.user.businessId;
    if (!businessId) return res.json({}); // Si es TI, no tiene config

    let settings = await Settings.findOne({ businessId });

    // Si no existe, crearla por defecto para esta empresa
    if (!settings) {
      settings = new Settings({
        companyName: 'Mi Empresa Nueva',
        businessId: businessId // <--- IMPORTANTE
      });
      await settings.save();
    }

    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. ACTUALIZAR CONFIGURACIÓN
router.put('/', async (req, res) => {
  try {
    const businessId = req.user.businessId;

    let settings = await Settings.findOne({ businessId });
    if (!settings) settings = new Settings({ businessId });

    Object.assign(settings, req.body);
    settings.updatedAt = new Date();

    await settings.save();
    res.json(settings);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 3. APLICAR MORA GLOBAL A TODOS LOS PRÉSTAMOS ACTIVOS
router.post('/apply-penalty-to-all', async (req, res) => {
  try {
    const businessId = req.user.businessId;

    // Obtener la config global actual
    const settings = await Settings.findOne({ businessId });
    if (!settings || !settings.defaultPenaltyConfig) {
      return res.status(400).json({ error: 'No hay una configuración global de mora definida. Ve a Configuración → Reglas de Mora primero.' });
    }

    const globalConfig = settings.defaultPenaltyConfig;

    // Obtener todos los préstamos activos y con atraso de esta empresa
    const loans = await Loan.find({
      businessId: { $in: [businessId, businessId.toString()] },
      status: { $in: ['active', 'past_due'] }
    });

    if (loans.length === 0) {
      return res.json({ updated: 0, message: 'No hay préstamos activos para actualizar.' });
    }

    // Actualizar penaltyConfig de cada préstamo, preservando paidPenalty
    const bulkOps = loans.map(loan => {
      const existingPaidPenalty = loan.penaltyConfig?.paidPenalty || 0;
      return {
        updateOne: {
          filter: { _id: loan._id },
          update: {
            $set: {
              penaltyConfig: {
                ...globalConfig.toObject ? globalConfig.toObject() : globalConfig,
                paidPenalty: existingPaidPenalty, // Preservar lo ya pagado
                calculatedPenalty: 0,
                pendingPenalty: 0,
                penaltyPeriodsOverdue: 0
              }
            }
          }
        }
      };
    });

    const result = await Loan.bulkWrite(bulkOps);

    res.json({
      updated: result.modifiedCount,
      total: loans.length,
      message: `✅ Se actualizó la configuración de mora en ${result.modifiedCount} préstamos.`,
      appliedConfig: globalConfig
    });

  } catch (error) {
    console.error('Error applying penalty to all loans:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;