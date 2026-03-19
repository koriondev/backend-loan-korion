const mongoose = require('mongoose');
require('dotenv').config();

const inspect = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        const Transaction = require('./models/Transaction');
        const Loan = require('./models/Loan');

        const allLoans = await Loan.find({});
        const loan = allLoans.find(x => x._id.toString().endsWith('3ed3b3'));

        if (!loan) {
            console.log("Loan #3ed3b3 not found");
            process.exit(0);
        }

        const clientId = loan.clientId;
        console.log("Searching for ALL transactions for Client:", clientId);

        const txs = await Transaction.find({
            client: clientId,
            type: 'in_payment'
        }).sort({ date: -1 });

        console.log("Total Client Transactions:", txs.length);
        let activeSum = 0;
        txs.forEach(t => {
            console.log(`${t.date.toISOString().split('T')[0]} | ${t.amount} | ID: ${t._id} | Loan: ${t.loan || t.loanV2 || t.loanV3 || 'NONE'}`);
            activeSum += t.amount;
        });
        console.log("Sum for client:", activeSum);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
inspect();
