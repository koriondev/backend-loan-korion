const express = require('express');
const router = express.Router();
const loanController = require('../controllers/loanController');

// --- IMPORTAR MIDDLEWARES DE SEGURIDAD ---
const authMiddleware = require('../middleware/authMiddleware');
const limitMiddleware = require('../middleware/limitMiddleware');

// 1. Obtener Atrasos (Protegido)
router.get('/arrears', authMiddleware, loanController.getArrears);

// 2. Crear Préstamo (Protegido + Verificación de Límite de Plan)
router.post('/', authMiddleware, limitMiddleware.checkLoanLimit, loanController.createLoan);

// 2.1 Previsualizar Préstamo (Protegido)
router.post('/preview', authMiddleware, loanController.previewLoan);

// 3. Listar Préstamos (Protegido)
router.get('/', authMiddleware, loanController.getLoans);

// 3.1 Obtener un Préstamo (Protegido)
router.get('/:id', authMiddleware, loanController.getLoan);

// 4. Registrar Pago (Protegido)
router.post('/pay', authMiddleware, loanController.registerPayment);

// 5. Simular Pago (Protegido) -> ¡AQUÍ FALTABA EL MIDDLEWARE!
router.get('/:id/payment-details', authMiddleware, loanController.getPaymentDetails);

// 6. Eliminar Préstamo
router.delete('/:id', authMiddleware, loanController.deleteLoan);

// 7. Editar Préstamo
router.put('/:id', authMiddleware, loanController.updateLoan);

module.exports = router;