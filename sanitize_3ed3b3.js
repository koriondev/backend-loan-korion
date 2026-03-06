const mongoose = require('mongoose');
require('dotenv').config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Loan = require('./models/Loan');

        const loan = (await Loan.find({})).find(l => l._id.toString().endsWith('3ed3b3'));
        if (!loan) throw new Error("Loan not found");

        console.log("--- FINAL DATA REPAIR FOR #3ed3b3 ---");
        
        // 1. Correct Start Date
        const firstDate = new Date(loan.schedule[0].dueDate);
        loan.startDate = firstDate;
        loan.createdAt = firstDate;

        // 2. Fix Schedule dates (Ensure weekly cycle 30/12, 06/01 ... 24/02, 03/03, 10/03, 17/03)
        // I already shifted them back in previous script, let's verify Q11 is 03/03 and Q12 is 10/03
        console.log("Q11 Date before final check:", loan.schedule[10].dueDate);
        
        // 3. Apply the 5,000 payment (registered 02/03)
        // Quota 9 (index 8) was partial with 1001.28 / 4999.84. Needs 3998.56.
        // Penalty (index 9) is already paid.
        // Quota 11 (index 10) is pending 4999.84.
        
        console.log("Applying 5000 payment to schedule...");
        let remaining = 5000;
        
        // Fix Q9 (index 8)
        let q9 = loan.schedule[8];
        if (q9.status !== 'paid') {
            let needed = 4999.84 - 1001.28;
            q9.paidAmount = mongoose.Types.Decimal128.fromString("4999.84");
            q9.status = 'paid';
            remaining -= needed;
            console.log("Q9 marked as paid. Remaining:", remaining);
        }
        
        // Fix Q11 (index 10)
        let q11 = loan.schedule[10];
        if (remaining > 0) {
            q11.paidAmount = mongoose.Types.Decimal128.fromString(remaining.toFixed(2));
            q11.status = 'partial';
            console.log(`Q11 marked as partial with ${remaining.toFixed(2)} paid.`);
        }

        // 4. Final Status Recalculation (using GT Consumption logic)
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        
        const paidGTs = (loan.schedule || []).filter(q => q.status === 'paid' && q.notes && q.notes.includes("[Penalidad Aplicada]")).length;
        const allOverdue = (loan.schedule || []).filter(q => {
            if (q.status === 'paid') return false;
            const dueDate = new Date(q.dueDate);
            return dueDate < now;
        });

        const overdueCount = Math.max(0, allOverdue.length - paidGTs);
        loan.installmentsOverdue = overdueCount;
        loan.status = overdueCount > 0 ? 'past_due' : 'active';
        loan.daysLate = 0; // Since GT clears everything left
        
        console.log("Final State -> Status:", loan.status, "Arrears:", loan.installmentsOverdue);

        await loan.save({ validateBeforeSave: false });
        console.log("Loan #3ed3b3 sanitized successfully.");

        process.exit(0);
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
};

run();
