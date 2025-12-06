/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PAYMENT ENGINE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Handles payment distribution logic for loan payments.
 * Order: Penalty → Interest → Capital
 */

/**
 * Distribute payment amount across loan obligations
 * @param {Object} loan - LoanV2 instance
 * @param {Number} amount - Payment amount
 * @param {Object} currentPenalty - Current penalty calculation result
 * @returns {Object} Distribution details
 */
const distributePayment = (loan, amount, currentPenalty) => {
    let remainingPayment = amount;

    const distribution = {
        appliedPenalty: 0,
        appliedInterest: 0,
        appliedCapital: 0,
        installmentUpdates: [],
        isFullPayoff: false,
        remainingBalance: 0
    };

    // 1. Apply to Penalty first
    const pendingPenalty = Math.max(0, currentPenalty.totalPenalty - (loan.penaltyConfig.paidPenalty || 0));

    if (pendingPenalty > 0) {
        const penaltyPayment = Math.min(remainingPayment, pendingPenalty);
        distribution.appliedPenalty = penaltyPayment;
        remainingPayment -= penaltyPayment;
    }

    // 2. Apply to Interest and Capital per installment
    for (let i = 0; i < loan.schedule.length; i++) {
        if (remainingPayment <= 0) break;

        const inst = loan.schedule[i];

        // Only process pending or partial installments
        if (inst.status !== 'pending' && inst.status !== 'partial') continue;

        const installmentUpdate = {
            number: inst.number,
            interestPaid: 0,
            capitalPaid: 0,
            newStatus: inst.status
        };

        // 2a. Pay Interest
        const pendingInterest = (inst.interest || 0) - (inst.interestPaid || 0);
        if (pendingInterest > 0) {
            const interestPayment = Math.min(remainingPayment, pendingInterest);
            installmentUpdate.interestPaid = interestPayment;
            distribution.appliedInterest += interestPayment;
            remainingPayment -= interestPayment;
        }

        // 2b. Pay Capital
        if (remainingPayment > 0) {
            let pendingCapital = (inst.capital || 0) - (inst.capitalPaid || 0);

            // Special case for Redito: allow capital payment even if capital in installment is 0
            if (loan.lendingType === 'redito' && pendingCapital === 0 && remainingPayment > 0) {
                pendingCapital = remainingPayment; // Allow any amount to capital
            }

            if (pendingCapital > 0) {
                const capitalPayment = Math.min(remainingPayment, pendingCapital);
                installmentUpdate.capitalPaid = capitalPayment;
                distribution.appliedCapital += capitalPayment;
                remainingPayment -= capitalPayment;
            }
        }

        // Determine new status
        const totalPaid = (inst.paidAmount || 0) + installmentUpdate.interestPaid + installmentUpdate.capitalPaid;
        const totalInterestPaid = (inst.interestPaid || 0) + installmentUpdate.interestPaid;
        const totalCapitalPaid = (inst.capitalPaid || 0) + installmentUpdate.capitalPaid;

        if (loan.lendingType === 'redito') {
            // For Redito, only interest matters for installment status
            if (totalInterestPaid >= (inst.interest - 0.1)) {
                installmentUpdate.newStatus = 'paid';
            } else if (totalInterestPaid > 0) {
                installmentUpdate.newStatus = 'partial';
            }
        } else {
            // For Fixed/Amortization, both interest and capital must be paid
            if (totalInterestPaid >= (inst.interest - 0.1) && totalCapitalPaid >= (inst.capital - 0.1)) {
                installmentUpdate.newStatus = 'paid';
            } else if (totalPaid > 0) {
                installmentUpdate.newStatus = 'partial';
            }
        }

        distribution.installmentUpdates.push(installmentUpdate);
    }

    // Check if loan is fully paid
    const totalPrincipalPaid = loan.schedule.reduce((sum, inst) => sum + (inst.capitalPaid || 0), 0) + distribution.appliedCapital;

    if (loan.lendingType === 'redito') {
        distribution.isFullPayoff = totalPrincipalPaid >= (loan.amount - 0.1);
    } else {
        const allInstallmentsPaid = loan.schedule.every(inst => {
            const update = distribution.installmentUpdates.find(u => u.number === inst.number);
            return update ? update.newStatus === 'paid' : inst.status === 'paid';
        });
        distribution.isFullPayoff = allInstallmentsPaid;
    }

    return distribution;
};

/**
 * Apply payment distribution to loan
 * @param {Object} loan - LoanV2 instance (will be mutated)
 * @param {Object} distribution - Distribution from distributePayment
 * @returns {Object} Updated loan
 */
const applyPaymentToLoan = (loan, distribution) => {
    // Update penalty paid
    if (distribution.appliedPenalty > 0) {
        loan.penaltyConfig.paidPenalty = (loan.penaltyConfig.paidPenalty || 0) + distribution.appliedPenalty;
    }

    // Update schedule
    distribution.installmentUpdates.forEach(update => {
        const inst = loan.schedule.find(i => i.number === update.number);
        if (inst) {
            inst.interestPaid = (inst.interestPaid || 0) + update.interestPaid;
            inst.capitalPaid = (inst.capitalPaid || 0) + update.capitalPaid;
            inst.paidAmount = (inst.interestPaid || 0) + (inst.capitalPaid || 0);
            inst.status = update.newStatus;

            if (inst.status === 'paid' && !inst.paidDate) {
                inst.paidDate = new Date();
            }
        }
    });

    // Update loan balance
    if (loan.lendingType === 'redito') {
        loan.currentCapital -= distribution.appliedCapital;
    } else {
        // For Fixed/Amortization, balance includes both capital and interest
        loan.currentCapital -= distribution.appliedCapital;
    }

    // Update financial model
    loan.financialModel.interestPaid = (loan.financialModel.interestPaid || 0) + distribution.appliedInterest;
    loan.financialModel.interestPending = loan.financialModel.interestTotal - loan.financialModel.interestPaid;

    // Update status
    if (distribution.isFullPayoff || loan.currentCapital <= 0.1) {
        loan.status = 'paid';
        loan.currentCapital = 0;
    } else {
        // Check for overdue
        const today = new Date();
        const hasOverdue = loan.schedule.some(inst =>
            inst.status !== 'paid' && new Date(inst.dueDate) < today
        );
        loan.status = hasOverdue ? 'past_due' : 'active';
    }

    loan.markModified('schedule');
    loan.markModified('penaltyConfig');
    loan.markModified('financialModel');

    return loan;
};

/**
 * Validate payment amount before processing
 * @param {Object} loan - LoanV2 instance
 * @param {Number} amount - Payment amount
 * @param {Object} currentPenalty - Current penalty
 * @returns {Object} { valid: boolean, message: string, maxAllowed: number }
 */
const validatePaymentAmount = (loan, amount, currentPenalty) => {
    if (amount <= 0) {
        return { valid: false, message: 'El monto debe ser mayor a 0', maxAllowed: 0 };
    }

    // Calculate total debt
    const pendingPenalty = Math.max(0, currentPenalty.totalPenalty - (loan.penaltyConfig.paidPenalty || 0));
    const pendingInterest = loan.schedule.reduce((sum, inst) => {
        return sum + ((inst.interest || 0) - (inst.interestPaid || 0));
    }, 0);
    const pendingCapital = loan.lendingType === 'redito'
        ? loan.currentCapital
        : loan.schedule.reduce((sum, inst) => sum + ((inst.capital || 0) - (inst.capitalPaid || 0)), 0);

    const totalDebt = pendingPenalty + pendingInterest + pendingCapital;

    // Allow overpayment buffer of 100
    if (amount > totalDebt + 100) {
        return {
            valid: false,
            message: `El monto excede la deuda total. Máximo permitido: ${Math.ceil(totalDebt)}`,
            maxAllowed: Math.ceil(totalDebt)
        };
    }

    return { valid: true, message: '', maxAllowed: totalDebt };
};

module.exports = {
    distributePayment,
    applyPaymentToLoan,
    validatePaymentAmount
};
