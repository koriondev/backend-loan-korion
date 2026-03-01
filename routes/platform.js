const express = require('express');
const router = express.Router();
const platformController = require('../controllers/platformController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

// 1. Authenticate session
router.use(authMiddleware);

// 2. Authorize platform roles (superadmin, ti)
router.use(roleMiddleware(['superadmin', 'ti']));

// 3. Platform endpoints
router.get('/plans', platformController.getPlans);
router.post('/businesses', platformController.createBusiness);
router.get('/businesses', platformController.getAllBusinesses);

// AQUI ESTABA EL ERROR: Asegúrate que diga .updateBusiness
router.put('/businesses/:id', platformController.updateBusiness);

router.get('/businesses/:id', platformController.getBusinessDetail);

module.exports = router;