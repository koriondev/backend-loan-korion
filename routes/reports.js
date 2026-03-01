const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);
router.get('/stats', reportController.getGeneralStats);
router.get('/closing', reportController.getClosingReport); // <--- NUEVA RUTA CIERRE DE CAJA
router.get('/revenue-share', reportController.getRevenueShareStats);
router.post('/ai-summary', reportController.generateAISummary); // <--- NUEVA RUTA AI

module.exports = router;