const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');
const authMiddleware = require('../middleware/authMiddleware'); // <--- 1. IMPORTAR

// --- 2. PROTEGER TODAS LAS RUTAS ---
// Sin esto, req.user es undefined y explota
router.use(authMiddleware); 

// Rutas
router.post('/', clientController.createClient);
router.get('/', clientController.getClients);
router.get('/:id', clientController.getClientProfile);
router.put('/:id', clientController.updateClient);
router.delete('/:id', clientController.deleteClient);

module.exports = router;