const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
const Transaction = require('./models/Transaction');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const searchEverywhere = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });
        const target = '429116';
        console.log(`Searching for "${target}" in Loans, Clients, and Transactions...`);

        // 1. Search Clients (Phone, Cedula, Name)
        const clients = await Client.find({ businessId: user.businessId });
        const foundClient = clients.find(c =>
            (c.phone && c.phone.includes(target)) ||
            (c.cedula && c.cedula.includes(target)) ||
            (c.name && c.name.includes(target)) ||
            (c._id.toString().includes(target))
        );

        if (foundClient) {
            console.log(`✅ Found in Client: ${foundClient.name} (ID: ${foundClient._id})`);
            // Find loans for this client
            const loans = await Loan.find({ client: foundClient._id });
            console.log(`Client has ${loans.length} loans.`);
            loans.forEach(l => console.log(`  Loan ID: ${l._id} - Amount: ${l.amount}`));
        }

        // 2. Search Transactions (ID, Metadata, Description)
        const transactions = await Transaction.find({ businessId: user.businessId });
        const foundTx = transactions.find(t =>
            t._id.toString().includes(target) ||
            (t.description && t.description.includes(target)) ||
            JSON.stringify(t.metadata).includes(target)
        );

        if (foundTx) {
            console.log(`✅ Found in Transaction: ${foundTx._id}`);
            console.log(`  Loan ID: ${foundTx.loan}`);
            console.log(`  Description: ${foundTx.description}`);
            if (foundTx.loan) {
                const loan = await Loan.findById(foundTx.loan).populate('client');
                if (loan) {
                    console.log(`  Linked Loan found: ${loan._id}`);
                    // Print loan details
                    console.log('═══════════════════════════════════════');
                    console.log(`PRÉSTAMO #${loan._id}`);
                    console.log(`Cliente: ${loan.client ? loan.client.name : 'SIN CLIENTE'}`);
                    console.log(`Estado: ${loan.status}`);
                    console.log('\n📅 SCHEDULE:');
                    loan.schedule.forEach(q => {
                        console.log(`  #${q.number} - Vence: ${new Date(q.dueDate).toLocaleDateString()} - Esperado: ${q.amount} - Estado: ${q.status}`);
                    });
                }
            }
        }

        if (!foundClient && !foundTx) {
            console.log('❌ Not found in Clients or Transactions.');
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

searchEverywhere();
