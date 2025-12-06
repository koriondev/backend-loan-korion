const { distributePayment } = require('./engines/paymentEngine');

// Mock Loan Data
const loan = {
    _id: 'mock_loan_id',
    amount: 10000,
    currentCapital: 10000,
    lendingType: 'redito',
    penaltyConfig: { paidPenalty: 0 },
    schedule: Array.from({ length: 12 }, (_, i) => ({
        number: i + 1,
        amount: 500,
        capital: 0,
        interest: 500,
        status: 'pending',
        interestPaid: 0,
        capitalPaid: 0,
        paidAmount: 0
    }))
};

// Mock Penalty
const currentPenalty = { totalPenalty: 0 };

// Test Payment of 8000
console.log('--- Testing Payment of 8000 ---');
const distribution = distributePayment(loan, 8000, currentPenalty);

console.log('Applied Penalty:', distribution.appliedPenalty);
console.log('Applied Interest:', distribution.appliedInterest);
console.log('Applied Capital:', distribution.appliedCapital);
console.log('Remaining Balance:', distribution.remainingBalance);

console.log('\n--- Installment Updates ---');
distribution.installmentUpdates.forEach(u => {
    if (u.interestPaid > 0 || u.capitalPaid > 0) {
        console.log(`Installment ${u.number}: IntPaid=${u.interestPaid}, CapPaid=${u.capitalPaid}, NewStatus=${u.newStatus}`);
    }
});
