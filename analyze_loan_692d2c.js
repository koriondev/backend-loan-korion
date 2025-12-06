const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Transaction = require('./models/Transaction');
const Client = require('./models/Client'); // Register Client model
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const analyzeLoan = async () => {
    try {
        const loanId = '692d2c339ee6c7e138429116';
        const loan = await Loan.findById(loanId).populate('client');

        if (!loan) {
            console.log('❌ Loan not found');
            process.exit(1);
        }

        console.log('═══════════════════════════════════════');
        console.log(`ANALYSIS FOR LOAN #${loan._id}`);
        console.log('═══════════════════════════════════════');
        console.log(`Client: ${loan.client.name}`);
        console.log(`Amount: ${loan.amount}`);
        console.log(`Balance (DB): ${loan.balance}`);
        console.log(`Status: ${loan.status}`);

        // 1. Check Schedule Consistency
        console.log('\n--- SCHEDULE ANALYSIS ---');
        let totalExpected = 0;
        let totalPaidSchedule = 0;
        let totalCapitalPaidSchedule = 0;
        let totalInterestPaidSchedule = 0;

        loan.schedule.forEach(q => {
            totalExpected += q.amount;
            totalPaidSchedule += q.paidAmount;
            totalCapitalPaidSchedule += q.paidCapital;
            totalInterestPaidSchedule += q.paidInterest;

            const isFullyPaid = q.paidAmount >= q.amount; // Simple check
            const statusMatch = (q.status === 'paid' && isFullyPaid) ||
                (q.status === 'partial' && q.paidAmount > 0 && q.paidAmount < q.amount) ||
                (q.status === 'pending' && q.paidAmount === 0);

            if (!statusMatch) {
                console.log(`⚠️ Mismatch in Quota #${q.number}: Status ${q.status} but Paid ${q.paidAmount}/${q.amount}`);
            }

            // Check breakdown sum
            if (Math.abs((q.paidCapital + q.paidInterest) - q.paidAmount) > 1) {
                console.log(`⚠️ Breakdown Mismatch in Quota #${q.number}: Cap ${q.paidCapital} + Int ${q.paidInterest} != Paid ${q.paidAmount}`);
            }
        });

        console.log(`Total Expected: ${totalExpected}`);
        console.log(`Total Paid (Schedule Sum): ${totalPaidSchedule}`);
        console.log(`  - Capital: ${totalCapitalPaidSchedule}`);
        console.log(`  - Interest: ${totalInterestPaidSchedule}`);

        // 2. Check Transactions
        console.log('\n--- TRANSACTION ANALYSIS ---');
        const transactions = await Transaction.find({
            $or: [
                { loan: loan._id },
                { 'metadata.loanId': loan._id.toString() }
            ]
        });

        let totalPaidTx = 0;
        transactions.forEach(tx => {
            console.log(`Tx ${tx._id} - Date: ${new Date(tx.date).toLocaleDateString()} - Amount: ${tx.amount} - Type: ${tx.type}`);
            if (tx.type === 'income') {
                totalPaidTx += tx.amount;
            }
        });

        console.log(`Total Paid (Transactions Sum): ${totalPaidTx}`);

        if (Math.abs(totalPaidTx - totalPaidSchedule) > 1) {
            console.log(`❌ CRITICAL: Transactions sum (${totalPaidTx}) != Schedule sum (${totalPaidSchedule})`);
        } else {
            console.log(`✅ Transactions match Schedule payments.`);
        }

        // Check for unlinked transactions for this client
        console.log('\n--- CLIENT TRANSACTIONS CHECK ---');
        const clientTxs = await Transaction.find({
            businessId: loan.businessId,
            // Assuming we can link by description or metadata if client field is missing, 
            // but let's check if we can find by client name or just list all recent incomes
        });

        // Filter manually since Transaction model might not have client field directly or it's not populated
        // Let's check if Transaction has 'client' field?
        // Based on previous scripts, it seems to have 'loan' but maybe not 'client' directly?
        // Let's check the Transaction model if I can. 
        // But for now, I'll search description for client name.

        const clientName = loan.client.name;
        const potentialTxs = clientTxs.filter(tx =>
            (tx.description && tx.description.includes(clientName)) ||
            (tx.metadata && JSON.stringify(tx.metadata).includes(clientName))
        );

        console.log(`Potential unlinked transactions for client "${clientName}":`);
        potentialTxs.forEach(tx => {
            if (tx.loan && tx.loan.toString() === loan._id.toString()) return; // Already linked
            console.log(`  Tx ${tx._id} - ${tx.date} - ${tx.amount} - ${tx.description}`);
        });

        // 3. Check Balance
        // Balance should be Total Expected (if fixed) - Total Paid? 
        // Or Principal - Capital Paid?
        // It depends on the lending type.
        console.log(`\n--- BALANCE ANALYSIS ---`);
        console.log(`Lending Type: ${loan.lendingType}`);

        let calculatedBalance = 0;
        if (loan.lendingType === 'amortization' || loan.lendingType === 'fixed') {
            // Usually Balance = Remaining Principal + Remaining Interest (for fixed)
            // Or just Remaining Principal?
            // Let's check what 'balance' field represents in this system.
            // Usually it's the total debt remaining.

            // Calculate remaining from schedule
            let remainingSchedule = 0;
            loan.schedule.forEach(q => {
                remainingSchedule += (q.amount - q.paidAmount);
            });
            console.log(`Remaining per Schedule: ${remainingSchedule}`);

            if (Math.abs(loan.balance - remainingSchedule) > 1) {
                console.log(`❌ Balance Mismatch: DB says ${loan.balance}, Schedule says ${remainingSchedule}`);
            } else {
                console.log(`✅ Balance matches Schedule remaining.`);
            }
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

analyzeLoan();
