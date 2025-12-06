const express = require('express');
const router = express.Router();
const loanControllerV2 = require('../controllers/loanControllerV2');
const authMiddleware = require('../middleware/authMiddleware');

// All routes require authentication
router.use(authMiddleware);

// ═══════════════════════════════════════════════════════════════════════════
// LOAN CRUD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @route   POST /api/v2/loans/preview
 * @desc    Preview loan schedule
 * @access  Private
 */
router.post('/preview', loanControllerV2.previewLoan);

/**
 * @route   POST /api/v2/loans
 * @desc    Create a new loan
 * @access  Private
 */
router.post('/', loanControllerV2.createLoan);

/**
 * @route   GET /api/v2/loans
 * @desc    Get all loans for business
 * @access  Private
 */
router.get('/', loanControllerV2.getLoans);

/**
 * @route   GET /api/v2/loans/:id
 * @desc    Get loan by ID
 * @access  Private
 */
router.get('/:id', loanControllerV2.getLoanById);

/**
 * @route   GET /api/v2/loans/:id/schedule
 * @desc    Get loan amortization schedule
 * @access  Private
 */
router.get('/:id/schedule', loanControllerV2.getLoanSchedule);

// ═══════════════════════════════════════════════════════════════════════════
// PAYMENTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @route   POST /api/v2/loans/:id/payments
 * @desc    Register a payment for a loan
 * @access  Private
 */
router.post('/:id/payments', loanControllerV2.registerPayment);

module.exports = router;
