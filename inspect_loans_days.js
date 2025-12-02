const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const inspectLoans = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });
        const allLoans = await Loan.find({ businessId: user.businessId }).populate('client');

        const targets = [
            { id: '1d8a59', day: 'Tuesday' },
            { id: '1d61c7', day: 'Sunday' },
            { id: '1d7ca3', day: 'Sunday' },
            { id: '1d5f78', day: 'Sunday' },
            { id: '1d5ade', day: 'Sunday' },
            { id: '1d76c8', day: 'Tuesday' }
        ];

        for (const target of targets) {
            const loan = allLoans.find(l => l._id.toString().toLowerCase().endsWith(target.id.toLowerCase()));

            if (loan) {
                console.log(`\n✅ Encontrado: ${loan._id} (${target.id})`);
                console.log(`   Cliente: ${loan.client?.name}`);
                console.log(`   Frecuencia: ${loan.frequency}`);
                console.log(`   Target Day: ${target.day}`);
                console.log(`   Schedule (First 3 Pending):`);

                const pending = loan.schedule.filter(q => q.status === 'pending' || q.status === 'partial');
                pending.slice(0, 3).forEach(q => {
                    const d = new Date(q.dueDate);
                    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                    console.log(`     #${q.number}: ${d.toLocaleDateString()} (${days[d.getDay()]}) - ${q.status}`);
                });
            } else {
                console.log(`\n❌ NO Encontrado: ${target.id}`);
            }
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

inspectLoans();
