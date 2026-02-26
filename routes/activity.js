const express = require('express');
const router = express.Router();
const activityController = require('../controllers/activityController');
const authMiddleware = require('../middleware/authMiddleware');

// Registrar pulso (requiere auth)
router.post('/heartbeat', authMiddleware, activityController.recordHeartbeat);

// Obtener reporte (solo accesible por TI o Admin del negocio)
// Nota: De momento el CompanyDetailModule es solo para TI
router.get('/business/:businessId', authMiddleware, activityController.getBusinessActivity);

module.exports = router;
