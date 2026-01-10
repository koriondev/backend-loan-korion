const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const repairLoan = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const loanId = '6927dea4312573d65d1d429a';
        const loan = await Loan.findById(loanId);

        if (!loan) {
            console.log('Loan not found');
            process.exit(1);
        }

        console.log(`Processing Loan ${loan._id}`);
        console.log(`Current Balance: ${loan.balance}`);

        let newBalance = 0;
        let updatedQuotas = 0;

        loan.schedule.forEach((q, i) => {
            // 1. Fix Breakdown if needed
            const paidAmount = q.paidAmount || 0;
            const paidInt = q.paidInterest || 0;
            const paidCap = q.paidCapital || 0;
            const breakdownSum = paidInt + paidCap;

            if (paidAmount > 0 && Math.abs(paidAmount - breakdownSum) > 0.1) {
                console.log(`Fixing breakdown for quota ${i + 1}. Paid: ${paidAmount}, Breakdown: ${breakdownSum}`);

                // Distribute paidAmount: Interest first, then Capital
                let remaining = paidAmount;

                const interestToPay = Math.min(remaining, q.interest);
                q.paidInterest = interestToPay;
                remaining -= interestToPay;

                q.paidCapital = remaining; // Rest goes to capital
                updatedQuotas++;
            }

            // 2. Recalculate Balance
            const pending = q.amount - paidAmount;
            if (pending > 0.1) {
                newBalance += pending;
            }
        });

        console.log(`New Calculated Balance: ${newBalance}`);

        if (Math.abs(loan.balance - newBalance) > 0.1 || updatedQuotas > 0) {
            console.log('Updating loan...');
            loan.balance = newBalance;
            await loan.save();
            console.log('Loan updated.');

            // Update Client
            const client = await Client.findById(loan.client);
            if (client) {
                // We can just re-run the fix-client-balances logic for this client
                // Or just update it here since we know this is the only active loan (based on previous inspect)
                // But safer to just set it to newBalance if we assume this is the only one, 
                // or fetch all active loans again.
                // Let's fetch all active loans to be safe.
                const loans = await Loan.find({
                    client: client._id,
                    status: { $in: ['active', 'past_due', 'bad_debt'] }
                });
                const totalDebt = loans.reduce((sum, l) => sum + (l._id.toString() === loanId ? newBalance : (l.balance || 0)), 0);

                console.log(`Updating Client Balance: ${client.balance} -> ${totalDebt}`);
                client.balance = totalDebt;
                await client.save();
            }
        } else {
            console.log('No changes needed.');
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

repairLoan();
