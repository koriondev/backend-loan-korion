const mongoose = require('mongoose');
require('dotenv').config();
const { getVal } = require('./utils/helpers');

const test = async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const Loan = require('./models/Loan');
    
    const loan = await Loan.findOne({ amount: 20000, duration: 16 }).sort({createdAt: -1});
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    
    const cuotasVencidas = loan.schedule.filter(q => q.status !== 'paid' && new Date(q.dueDate) < today);
    let totalC = 0; let totalI = 0;
    
    console.log("Cuotas vencidas count:", cuotasVencidas.length);
    cuotasVencidas.forEach(q => {
        const cP = getVal(q.principalAmount || q.capital);
        const cId = getVal(q.capitalPaid);
        const iP = getVal(q.interestAmount || q.interest);
        const iId = getVal(q.interestPaid);
        console.log(`Q#${q.number}: Principal=${cP}(Paid=${cId}) Interest=${iP}(Paid=${iId}) :: Pending=${(cP-cId) + (iP-iId)}`);
        totalC += Math.max(0, cP - cId);
        totalI += Math.max(0, iP - iId);
    });
    console.log("Capital Vencido:", totalC);
    console.log("Interes Vencido:", totalI);
    console.log("Total Vencido:", totalC + totalI);
    
    process.exit(0);
}
test();
