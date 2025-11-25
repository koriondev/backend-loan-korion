const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const authMiddleware = require('../middleware/authMiddleware');

// Proteger rutas
router.use(authMiddleware);

router.get('/', productController.getProducts);
router.post('/', productController.createProduct);

module.exports = router;