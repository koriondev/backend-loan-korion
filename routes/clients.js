const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');
const authMiddleware = require('../middleware/authMiddleware'); // <--- 1. IMPORTAR
const upload = require('../middleware/uploadMiddleware'); // <--- Upload middleware

// --- 2. PROTEGER TODAS LAS RUTAS ---
// Sin esto, req.user es undefined y explota
router.use(authMiddleware);

// Rutas
// POST with file uploads (idCardFront, idCardBack, photo)
router.post('/', upload.fields([
    { name: 'idCardFront', maxCount: 1 },
    { name: 'idCardBack', maxCount: 1 },
    { name: 'photo', maxCount: 1 }
]), clientController.createClient);

router.get('/', clientController.getClients);
router.get('/:id', clientController.getClientProfile);

// PUT with file uploads
router.put('/:id', upload.fields([
    { name: 'idCardFront', maxCount: 1 },
    { name: 'idCardBack', maxCount: 1 },
    { name: 'photo', maxCount: 1 }
]), clientController.updateClient);

router.delete('/:id', clientController.deleteClient);

module.exports = router;