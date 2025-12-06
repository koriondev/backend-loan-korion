const mongoose = require('mongoose');
const Loan = require('./models/Loan');
require('dotenv').config({ path: './backend/.env' });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log('Connected to MongoDB');

        // Fechas (Replicating logic from reportController)
        const today = new Date();
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

        console.log(`Start of Month: ${startOfMonth.toISOString()}`);
        console.log(`End of Month: ${endOfMonth.toISOString()}`);

        const businessId = '692635b070e60fc23382fe56'; // Starlyn's Business ID
    const activeLoans = await Loan.find({ status: 'active', businessId: businessId });
        console.log(`Found ${activeLoans.length} active loans.`);

        let totalMonthlyGain = 0;

        activeLoans.forEach(loan => {
            let loanMonthlyGain = 0;
            let installmentsInMonth = 0;

            if (loan.schedule && loan.schedule.length > 0) {
                loan.schedule.forEach(q => {
                    const dueDate = new Date(q.dueDate);
                    const isInMonth = dueDate >= startOfMonth && dueDate <= endOfMonth;

                    if (isInMonth) {
                        console.log(`Loan ${loan._id} - Installment #${q.number}: Due=${dueDate.toISOString().split('T')[0]}, Interest=${q.interest}`);
                        loanMonthlyGain += (q.interest || 0);
                        installmentsInMonth++;
                    }
                });
            }

            if (installmentsInMonth > 0) {
                console.log(`-> Loan ${loan._id} Total Monthly Gain: ${loanMonthlyGain}`);
                totalMonthlyGain += loanMonthlyGain;
            }
        });

        console.log('--------------------------------------------------');
        console.log(`Total Calculated Monthly Gain: ${totalMonthlyGain}`);

        process.exit();
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
