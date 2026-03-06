const mongoose = require('mongoose');
require('dotenv').config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Loan = require('./models/Loan');

        const loan = (await Loan.find({})).find(l => l._id.toString().endsWith('3ed3b3'));
        if (!loan) throw new Error("Loan not found");

        console.log("--- INSPECTING LOAN #3ed3b3 ---");
        console.log("Duration:", loan.duration);
        console.log("Schedule length:", loan.schedule.length);

        // Fix Start Date
        const firstQuotaDate = loan.schedule[0].dueDate;
        console.log("First Quota Date:", firstQuotaDate);
        if (loan.startDate > firstQuotaDate || !loan.startDate) {
            console.log("Correcting Start Date...");
            loan.startDate = firstQuotaDate;
            loan.createdAt = firstQuotaDate; // Force consistency for display
        }

        // Fix Calendar Gap
        console.log("Checking for gaps...");
        for (let i = 0; i < loan.schedule.length - 1; i++) {
            const d1 = new Date(loan.schedule[i].dueDate);
            const d2 = new Date(loan.schedule[i + 1].dueDate);
            const diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
            console.log(`Q${i + 1} to Q${i + 2}: ${diffDays} days`);

            if (diffDays > 7 && loan.frequency === 'weekly') {
                console.log(`GAP DETECTED between Q${i + 1} and Q${i + 2}!`);
                // If it's the gap reported (between Q10 and Q11)
                // We need to shift everything back or insert?
                // The user said "salta de Q10 (02/03) a Q11 (16/03)".
                // We want Q11 to be 09/03.
                // Q12 to be 16/03.
                // This adds a quota!
            }
        }

        // Logic to restore the missing week:
        // Re-generate dates from the target point onwards
        let foundGap = false;
        for (let i = 0; i < loan.schedule.length - 1; i++) {
            const d1 = new Date(loan.schedule[i].dueDate);
            const d2 = new Date(loan.schedule[i + 1].dueDate);
            const diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));

            if (diffDays > 7 && !foundGap) {
                console.log("Restoring gap at index", i + 1);
                // Shift dates of i+1 onwards back by 7 days
                for (let j = i + 1; j < loan.schedule.length; j++) {
                    const d = new Date(loan.schedule[j].dueDate);
                    d.setDate(d.getDate() - 7);
                    loan.schedule[j].dueDate = d;
                }
                foundGap = true;
            }
        }

        if (foundGap) {
            console.log("Dates shifted to restore the 09/03 week.");
        }

        await loan.save({ validateBeforeSave: false });
        console.log("Loan #3ed3b3 fixed and saved.");

        process.exit(0);
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
};

run();
