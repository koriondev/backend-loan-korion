const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
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

module.exports = router;