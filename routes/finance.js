const express = require('express');
const router = express.Router();
const financeController = require('../controllers/financeController');
const authMiddleware = require('../middleware/authMiddleware');

// Proteger todas las rutas con autenticación
router.use(authMiddleware);

// Transacciones (Ya la tenías)
router.post('/transactions', financeController.createTransaction);

// Carteras (Nuevas)
router.get('/transactions', financeController.getHistory);
router.get('/wallets', financeController.getWallets);
router.post('/wallets', financeController.createWallet);
router.delete('/wallets/:id', financeController.deleteWallet); // <--- NUEVA
router.get('/wallets/:id', financeController.getWalletDetails); // <--- NUEVA
router.put('/wallets/:id/default', financeController.setWalletDefault);
router.put('/wallets/:id/balance', financeController.adjustWalletBalance); // <--- NUEVA

// Eliminar Transacción (Solo movimientos sin cliente)
router.delete('/transactions/:id', financeController.deleteTransaction);


module.exports = router;