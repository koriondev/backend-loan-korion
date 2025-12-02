const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const findLoans = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });
        const allLoans = await Loan.find({ businessId: user.businessId }).populate('client');

        const targetIds = ['1d721b', '1d4cdf', '1s4cdf', '1d4590', '1d4abd', '1d4833'];

        console.log('Buscando préstamos...');

        for (const shortId of targetIds) {
            const loan = allLoans.find(l => l._id.toString().toLowerCase().endsWith(shortId.toLowerCase()));

            if (loan) {
                console.log(`\n✅ Encontrado: ${loan._id} (${shortId})`);
                console.log(`   Cliente: ${loan.client?.name}`);
                console.log(`   Frecuencia: ${loan.frequency}`);
                console.log(`   Schedule (First 3):`);
                loan.schedule.slice(0, 3).forEach(q => {
                    console.log(`     #${q.number}: ${new Date(q.dueDate).toLocaleDateString()} - ${q.status}`);
                });
            } else {
                console.log(`\n❌ NO Encontrado: ${shortId}`);
            }
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

findLoans();
