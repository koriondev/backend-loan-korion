const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

mongoose.connect(process.env.MONGO_URI, { dbName: 'test' }).then(async () => {
    try {
        const LoanV3 = require('./models/LoanV3.js');
        const loan = await LoanV3.findById('69a06702371843c325ebc15a').lean();
        
        if (!loan) {
            console.log("Loan not found");
        } else {
            console.log("Loan found. Schedule 0:");
            console.log(JSON.stringify(loan.schedule[0], null, 2));
        }
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
});
