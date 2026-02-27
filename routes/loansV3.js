const express = require('express');
const router = express.Router();
const loanControllerV3 = require('../controllers/loanControllerV3');
const authMiddleware = require('../middleware/authMiddleware');
const subscriptionMiddleware = require('../middleware/subscriptionMiddleware');

// All routes require authentication
router.use(authMiddleware);

// ═══════════════════════════════════════════════════════════════════════════
// LOAN CRUD
// ═══════════════════════════════════════════════════════════════════════════

// Preview route
router.post('/preview', loanControllerV3.previewLoan);

/**
 * @route   POST /api/v3/loans
 * @desc    Create a new loan
 * @access  Private
 */
router.post('/',
    subscriptionMiddleware.checkSubscription,
    subscriptionMiddleware.checkLoanLimit,
    loanControllerV3.createLoan
);

/**
 * @route   GET /api/v3/loans
 * @desc    Get all loans for business
 * @access  Private
 */
router.get('/', loanControllerV3.getLoans);

/**
 * @route   GET /api/v3/loans/:id
 * @desc    Get loan by ID
 * @access  Private
 */
router.get('/:id', loanControllerV3.getLoanById);

/**
 * @route   GET /api/v3/loans/:id/schedule
 * @desc    Get loan amortization schedule
 * @access  Private
 */
router.get('/:id/schedule', loanControllerV3.getLoanSchedule);
router.post('/:id/approve', loanControllerV3.approveLoan);
router.post('/:id/reject', loanControllerV3.rejectLoan);

// ═══════════════════════════════════════════════════════════════════════════
// PAYMENTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @route   POST /api/v3/loans/:id/payments
 * @desc    Register a payment for a loan
 * @access  Private
 */
router.post('/:id/payments', loanControllerV3.registerPayment);
router.post('/:id/apply-penalty', loanControllerV3.applyPenalty);
router.get('/:id/payments', loanControllerV3.getLoanPayments);
router.delete('/:id/payments/:paymentId', loanControllerV3.deletePaymentV3);

module.exports = router;
