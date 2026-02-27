const express = require('express');
const router = express.Router();
const loanController = require('../controllers/loanController');

// --- IMPORTAR MIDDLEWARES DE SEGURIDAD ---
const authMiddleware = require('../middleware/authMiddleware');
const subscriptionMiddleware = require('../middleware/subscriptionMiddleware');
// Eliminamos limitMiddleware antiguo ya que usaremos el nuevo subscriptionMiddleware

// 1. Obtener Atrasos (Protegido)
router.get('/arrears', authMiddleware, loanController.getArrears);

// 2. Crear Préstamo (Protegido + Verificación de Límite de Plan)
router.post('/',
    authMiddleware,
    subscriptionMiddleware.checkSubscription,
    subscriptionMiddleware.checkLoanLimit,
    loanController.createLoan
);

// 2.1 Previsualizar Préstamo (Protegido)
router.post('/preview', authMiddleware, loanController.previewLoan);

// 3. Listar Préstamos (Protegido)
router.get('/', authMiddleware, loanController.getLoans);

// 3.1 Obtener un Préstamo (Protegido)
router.get('/:id', authMiddleware, loanController.getLoan);

// 4. Registrar Pago (Protegido)
router.post('/pay', authMiddleware, loanController.registerPayment);
router.post('/:id/apply-penalty', authMiddleware, loanController.applyPenalty);

// 5. Simular Pago (Protegido)
router.get('/:id/payment-details', authMiddleware, loanController.getPaymentDetails);

// 6. Eliminar Pago/Transacción (MOVILIZADO POR COLISION CON :id)
router.delete('/payment/:transactionId', authMiddleware, loanController.deletePayment);

// 7. Actualizar Monto de Pago (MOVILIZADO POR COLISION CON :id)
router.put('/payment/:transactionId', authMiddleware, loanController.updatePaymentAmount);

// 8. Eliminar Préstamo
router.delete('/:id', authMiddleware, loanController.deleteLoan);

// 9. Editar Préstamo
router.put('/:id', authMiddleware, loanController.updateLoan);

// 10. Actualizar Configuración de Mora
router.put('/:loanId/penalty-config', authMiddleware, loanController.updatePenaltyConfig);

// 11. Recalcular Atrasos
router.post('/recalculate-overdue', authMiddleware, loanController.recalculateOverdue);

module.exports = router;