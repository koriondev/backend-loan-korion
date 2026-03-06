const mongoose = require('mongoose');
require('dotenv').config();

const run = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Loan = require('./models/Loan');

        const loan = (await Loan.find({})).find(l => l._id.toString().endsWith('3ed3b3'));
        if (!loan) throw new Error("Loan not found");

        console.log("--- RE-FIXING CALENDAR FOR #3ed3b3 ---");

        // Find the gap between Q10 and Q11
        // Q10 should be around 23 Feb/2 March
        // Let's find index where diff is > 10 days
        let fixed = false;
        for (let i = 0; i < loan.schedule.length - 1; i++) {
            const d1 = new Date(loan.schedule[i].dueDate);
            const d2 = new Date(loan.schedule[i + 1].dueDate);
            const diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));

            if (diffDays >= 13 && d1 > new Date('2026-02-01')) {
                console.log(`Targeting shift at index ${i + 1} (Date: ${d2.toISOString()})`);
                // Shift this and all subsequent dates back by 7 days
                for (let j = i + 1; j < loan.schedule.length; j++) {
                    const d = new Date(loan.schedule[j].dueDate);
                    d.setDate(d.getDate() - 7);
                    loan.schedule[j].dueDate = d;
                }
                fixed = true;
                break;
            }
        }

        if (fixed) {
            console.log("Schedule shifted back by 7 days to close the gap.");
            await loan.save({ validateBeforeSave: false });
            console.log("Loan saved.");
        } else {
            console.log("No 14-day gap found in recent quotas.");
        }

        process.exit(0);
    } catch (error) {
        console.error("Error:", error);
        process.exit(1);
    }
};

run();
