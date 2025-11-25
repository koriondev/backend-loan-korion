const express = require('express');
const router = express.Router();
const loanController = require('../controllers/loanController');

// --- IMPORTAR MIDDLEWARES DE SEGURIDAD (ESTO FALTABA) ---
const authMiddleware = require('../middleware/authMiddleware');
const limitMiddleware = require('../middleware/limitMiddleware');

// 1. Obtener Atrasos (Protegido)
router.get('/arrears', authMiddleware, loanController.getArrears);

// 2. Crear Préstamo (Protegido + Verificación de Límite de Plan)
router.post('/', authMiddleware, limitMiddleware.checkLoanLimit, loanController.createLoan);

// 3. Listar Préstamos (Protegido)
router.get('/', authMiddleware, loanController.getLoans);

// 4. Registrar Pago (Protegido)
router.post('/pay', authMiddleware, loanController.registerPayment);

// 5. Eliminar Préstamo (Opcional, si agregaste la función en el controller)
if (loanController.deleteLoan) {
    router.delete('/:id', authMiddleware, loanController.deleteLoan);
}

module.exports = router;