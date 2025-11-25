const express = require('express');
const router = express.Router();
const platformController = require('../controllers/platformController');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

router.get('/plans', platformController.getPlans);
router.post('/businesses', platformController.createBusiness);
router.get('/businesses', platformController.getAllBusinesses);

// AQUI ESTABA EL ERROR: Asegúrate que diga .updateBusiness
router.put('/businesses/:id', platformController.updateBusiness); 

router.get('/businesses/:id', platformController.getBusinessDetail);

module.exports = router;