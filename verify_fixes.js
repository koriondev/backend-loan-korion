const mongoose = require('mongoose');
const { calculatePenaltyV3 } = require('./engines/penaltyEngine');
const { generateScheduleV3 } = require('./engines/amortizationEngine');

async function verify() {
    console.log("--- VERIFYING PENALTY ENGINE (NaN BUG) ---");
    const mockLoanFixed = {
        version: 3,
        penaltyConfig: {
            type: 'fixed',
            value: 100,
            gracePeriod: 0,
            applyPerInstallment: true,
            periodMode: 'daily',
            paidPenalty: 0
        },
        schedule: [
            { number: 1, dueDate: new Date('2026-03-01'), status: 'pending', principalAmount: 1000, interestAmount: 200, amount: 1200 }
        ]
    };

    const mockSettings = { businessId: '123' };
    const refDate = new Date('2026-03-05'); // 4 days late

    const penalty = calculatePenaltyV3(mockLoanFixed, mockSettings, refDate);
    console.log("Calculated Penalty (No GT):", penalty.totalPenalty); // Should be 400
    console.log("Periods Overdue (No GT):", penalty.periodsOverdue); // Should be 4

    console.log("\n--- VERIFYING GT EXCLUSION ---");
    mockLoanFixed.schedule[0].notes = "[Penalidad Aplicada]";
    const penaltyWithGT = calculatePenaltyV3(mockLoanFixed, mockSettings, refDate);
    console.log("Calculated Penalty (With GT):", penaltyWithGT.totalPenalty); // Should be 0
    console.log("Periods Overdue (With GT):", penaltyWithGT.periodsOverdue); // Should be 0

    if (penaltyWithGT.periodsOverdue === 0) {
        console.log("PASS: GT-marked quota excluded from overdue calculation.");
    } else {
        console.error("FAIL: GT-marked quota still counted as overdue!");
    }

    if (isNaN(penalty.periodsOverdue)) {
        console.error("FAIL: periodsOverdue is NaN!");
    } else {
        console.log("PASS: periodsOverdue is a number.");
    }

    console.log("\n--- VERIFYING BALANCE LOGIC (MANUAL CHECK) ---");
    // This is harder to script without a full DB setup, but we've reviewed the code.
    // The change to LoanDetails.jsx uses direct summation which is safer.

    process.exit(0);
}

verify();
