require('dotenv').config();
const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');
const Loan = require('./models/Loan');

const reconstruct = async () => {
    try {
        const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';
        await mongoose.connect(MONGO_URI);
        console.log('🟢 Connected to MongoDB');

        // 1. Fetch all Loans
        const loans = await Loan.find({});
        console.log(`Processing ${loans.length} loans...`);

        let updatedCount = 0;

        for (const loan of loans) {
            // 2. Fetch transactions for this loan (using regex on description or metadata)
            // We need to find transactions that belong to this loan.
            // Strategy: Search by metadata.loanId OR description regex
            const loanIdStr = loan._id.toString().slice(-6);
            const txs = await Transaction.find({
                type: 'in_payment',
                $or: [
                    { 'metadata.loanId': loan._id },
                    { description: { $regex: loanIdStr } }
                ]
            }).sort({ date: 1 }); // Oldest first

            if (txs.length === 0) continue;

            console.log(`Loan ${loan._id} has ${txs.length} payments.`);

            // 3. Initialize "Allocated" trackers for the schedule
            // We will simulate "filling" the schedule buckets with the transaction money
            const allocated = loan.schedule.map(q => ({
                paidInterest: 0,
                paidCapital: 0
            }));

            for (const tx of txs) {
                // Skip if already has breakdown (optional, but user asked to update "ya realizados", maybe some are partial?)
                // Let's overwrite to be safe and consistent, OR only if missing.
                // User said "actualizar los pagos ya realizados", implying they are wrong/missing.
                // Let's re-calculate all to ensure consistency with the current schedule.

                let breakdown = { appliedToCapital: 0, appliedToInterest: 0, appliedToMora: 0 };

                // A. Extract Mora from description
                const moraMatch = tx.description.match(/Mora:\s*(\d+(\.\d+)?)/);
                let mora = moraMatch ? Number(moraMatch[1]) : 0;
                breakdown.appliedToMora = mora;

                let moneyToAllocate = tx.amount - mora;

                // B. Allocate to Schedule (Interest then Capital)
                for (let i = 0; i < loan.schedule.length; i++) {
                    if (moneyToAllocate <= 0.01) break;

                    const q = loan.schedule[i];
                    const alloc = allocated[i];

                    // 1. Interest
                    // How much interest is "paid" in the DB for this quota?
                    const dbPaidInterest = q.paidInterest || 0;
                    // How much have we already attributed to previous transactions?
                    const remainingInterestInQuota = dbPaidInterest - alloc.paidInterest;

                    if (remainingInterestInQuota > 0) {
                        const take = Math.min(moneyToAllocate, remainingInterestInQuota);
                        breakdown.appliedToInterest += take;
                        alloc.paidInterest += take;
                        moneyToAllocate -= take;
                    }

                    if (moneyToAllocate <= 0.01) continue;

                    // 2. Capital
                    const dbPaidCapital = q.paidCapital || 0;
                    const remainingCapitalInQuota = dbPaidCapital - alloc.paidCapital;

                    if (remainingCapitalInQuota > 0) {
                        const take = Math.min(moneyToAllocate, remainingCapitalInQuota);
                        breakdown.appliedToCapital += take;
                        alloc.paidCapital += take;
                        moneyToAllocate -= take;
                    }
                }

                // C. If money still remains (e.g. extra capital not in schedule, or Redito general capital)
                if (moneyToAllocate > 0.01) {
                    // Assign to Capital (General)
                    breakdown.appliedToCapital += moneyToAllocate;
                }

                // D. Update Transaction
                // Ensure metadata object exists
                if (!tx.metadata) tx.metadata = {};
                tx.metadata.loanId = loan._id; // Ensure link
                tx.metadata.breakdown = breakdown;

                tx.markModified('metadata');
                await tx.save();
                updatedCount++;
                console.log(`  -> Tx ${tx._id}: Cap=${breakdown.appliedToCapital.toFixed(2)}, Int=${breakdown.appliedToInterest.toFixed(2)}, Mora=${breakdown.appliedToMora.toFixed(2)}`);
            }
        }

        console.log(`✅ Reconstruction complete. Updated ${updatedCount} transactions.`);
        process.exit(0);

    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

reconstruct();
