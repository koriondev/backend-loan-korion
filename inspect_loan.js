const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const inspectLoan = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        // Find loan where _id ends with 1d429a
        // Since we can't easily query by suffix on ObjectId in Mongo without aggregation or regex (which works on strings),
        // we'll fetch all loans for the client "Papa kelvicito" first if possible, or just use regex on ObjectId string if supported,
        // or fetch all and filter in JS (inefficient but works for small DB).
        // Better: The user gave "Papa kelvicito". Let's find the client first.

        const client = await Client.findOne({ name: /Papa kelvicito/i });
        if (!client) {
            console.log('Client "Papa kelvicito" not found.');
            // Fallback: Try to find loan by regex on stringified ID if possible, or just list all loans and filter.
            // Let's try listing all loans and filtering by ID suffix.
            const loans = await Loan.find({});
            const targetLoan = loans.find(l => l._id.toString().endsWith('1d429a'));
            if (targetLoan) {
                console.log('Loan found by ID suffix!');
                printLoanDetails(targetLoan);
            } else {
                console.log('Loan not found.');
            }
        } else {
            console.log(`Client found: ${client.name} (${client._id})`);
            console.log(`Client Balance: ${client.balance}`);

            const loans = await Loan.find({ client: client._id });
            const targetLoan = loans.find(l => l._id.toString().endsWith('1d429a'));

            if (targetLoan) {
                console.log('Loan found!');
                printLoanDetails(targetLoan);
            } else {
                console.log('Loan #1d429a not found for this client. Listing all loans for client:');
                loans.forEach(l => console.log(`- ${l._id} (${l.status}): ${l.amount}`));
            }
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

function printLoanDetails(loan) {
    console.log('------------------------------------------------');
    console.log(`Loan ID: ${loan._id}`);
    console.log(`Type: ${loan.lendingType} | Status: ${loan.status}`);
    console.log(`Amount: ${loan.amount} | Balance: ${loan.balance}`);
    console.log(`Total To Pay: ${loan.totalToPay}`);
    console.log(`Paid Late Fee: ${loan.paidLateFee}`);

    let calculatedBalance = 0;
    let pendingCount = 0;
    let paidCount = 0;
    let partialCount = 0;

    console.log('Schedule Analysis:');
    loan.schedule.forEach((q, i) => {
        const pendingAmount = q.amount - (q.paidAmount || 0);
        if (q.status !== 'paid') {
            calculatedBalance += pendingAmount;
            if (q.status === 'partial') partialCount++;
            else pendingCount++;
        } else {
            paidCount++;
            // Even if paid, check if there's any discrepancy
            if (pendingAmount > 0.1) console.log(`  WARNING: Quota ${i + 1} is PAID but has pending amount: ${pendingAmount}`);
        }

        if (q.status === 'partial' || (q.status === 'pending' && i < 25)) { // Show partials and early pendings
            console.log(`  [${i + 1}] Due: ${q.dueDate.toISOString().split('T')[0]} | Status: ${q.status}`);
            console.log(`      Total: ${q.amount} | Paid: ${q.paidAmount || 0} | Pending: ${pendingAmount}`);
            console.log(`      Interest: ${q.interest} (Paid: ${q.paidInterest || 0})`);
            console.log(`      Capital: ${q.capital} (Paid: ${q.paidCapital || 0})`);
        }
    });

    console.log('------------------------------------------------');
    console.log(`Summary:`);
    console.log(`  Paid Quotas: ${paidCount}`);
    console.log(`  Partial Quotas: ${partialCount}`);
    console.log(`  Pending Quotas: ${pendingCount}`);
    console.log(`  Calculated Balance (Sum of pending): ${calculatedBalance}`);
    console.log(`  Stored Loan Balance: ${loan.balance}`);
    console.log(`  Difference: ${loan.balance - calculatedBalance}`);
    console.log('------------------------------------------------');
}

inspectLoan();
