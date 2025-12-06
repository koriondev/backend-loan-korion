const mongoose = require('mongoose');
const LoanV2 = require('./models/LoanV2');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
const Settings = require('./models/Settings');
const User = require('./models/User');
require('dotenv').config({ path: './backend/.env' });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    
    // Get Starlyn's business ID
    const user = await User.findOne({ name: 'Starlyn Acevedo' });
    const businessId = user.businessId;
    console.log('Business ID:', businessId);

    // 1. Fetch V2 Loans
    const loansV2 = await LoanV2.find({ businessId })
        .populate('clientId', 'name cedula phone')
        .sort({ createdAt: -1 });
    console.log(`Found ${loansV2.length} V2 loans`);

    // 2. Fetch V1 Loans
    const loansV1 = await Loan.find({ businessId })
        .populate('client', 'name cedula phone')
        .sort({ createdAt: -1 });
    console.log(`Found ${loansV1.length} V1 loans`);

    // 3. Map V1 Loans
    const mappedLoansV1 = loansV1.map(l => {
        const loanObj = l.toObject();
        return {
            ...loanObj,
            clientId: loanObj.client,
            client: undefined,
            isV1: true,
            status: loanObj.status === 'bad_debt' ? 'bad_debt' :
                    loanObj.status === 'past_due' ? 'past_due' :
                    loanObj.status === 'paid' ? 'paid' : 'active',
            currentCapital: loanObj.currentCapital || loanObj.amount,
            schedule: loanObj.schedule || []
        };
    });

    // Check mapped V1 loans
    const paidV1 = mappedLoansV1.filter(l => l.status === 'paid');
    console.log(`Mapped ${paidV1.length} paid V1 loans`);
    
    if (paidV1.length > 0) {
        console.log('Sample Paid V1 Loan:', JSON.stringify(paidV1[0], null, 2));
    }

    process.exit();
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
