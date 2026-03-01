const express = require('express');
const router = express.Router();
const activityController = require('../controllers/activityController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

// Registrar pulso (requiere auth)
router.post('/heartbeat', authMiddleware, activityController.recordHeartbeat);

// Obtener reporte (Solo accesible por Super/TI o Admin/Manager del negocio)
router.get('/business/:businessId', authMiddleware, roleMiddleware(['ti', 'superadmin', 'admin', 'manager']), activityController.getBusinessActivity);

module.exports = router;
