const express = require('express');
const router = express.Router();
const loanController = require('../controllers/loanController');
const auditController = require('../controllers/auditController');
const authMiddleware = require('../middleware/authMiddleware');
const subscriptionMiddleware = require('../middleware/subscriptionMiddleware');

// All routes require authentication
router.use(authMiddleware);

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT ROUTES
// ═══════════════════════════════════════════════════════════════════════════
router.get('/audit/pending', auditController.getPendingAudits);
router.post('/audit/report', auditController.reportAudit);
router.get('/audit/discrepancies', auditController.getDiscrepancies);
router.put('/audit/discrepancies/:id/corrected', auditController.markAsCorrected);

// ═══════════════════════════════════════════════════════════════════════════
// LOAN COLLECTION ROUTES
// ═══════════════════════════════════════════════════════════════════════════

router.get('/arrears', loanController.getArrears);
router.post('/pay', loanController.payLoan);

router.post('/preview', loanController.previewLoan);

router.get('/', loanController.getLoans);

router.post('/',
    subscriptionMiddleware.checkSubscription,
    subscriptionMiddleware.checkLoanLimit,
    loanController.createLoan
);


// ═══════════════════════════════════════════════════════════════════════════
// SPECIFIC LOAN ROUTES (More specific routes first)
// ═══════════════════════════════════════════════════════════════════════════

router.get('/:id/payments', loanController.getLoanPayments);
router.post('/:id/payments', loanController.registerPayment);
router.post('/:id/recalculate', loanController.recalculateLoan);
router.delete('/:id/payments/:paymentId', loanController.deletePayment);

router.post('/:id/apply-penalty', loanController.applyPenalty);

router.get('/:id/schedule', loanController.getLoanSchedule);
router.post('/:id/approve', loanController.approveLoan);
router.post('/:id/reject', loanController.rejectLoan);

router.put('/:id/archive', loanController.archiveLoan);
router.put('/:id/restore', loanController.restoreLoan);

// Catch-all for getting a single loan record
router.get('/:id', loanController.getLoanById);

module.exports = router;
