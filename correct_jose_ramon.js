const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Client = require('./models/Client');
const User = require('./models/User');
const Transaction = require('./models/Transaction');
const Wallet = require('./models/Wallet');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const correctJoseRamonPayment = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });

        const allLoans = await Loan.find({
            businessId: user.businessId,
            lendingType: 'redito'
        }).populate('client');

        const loan = allLoans.find(l => l._id.toString().endsWith('1d61c7'));

        if (!loan) {
            console.error('❌ Préstamo no encontrado');
            process.exit(1);
        }

        console.log(`✅ Préstamo: ${loan.client.name} - ${loan._id}\n`);

        // CORRECCIÓN:
        // Cuota #1 tiene paidAmount: 475, pero debería tener 500
        // La mora de 25 pesos fue incorrecta

        const quota1 = loan.schedule[0];

        console.log('ANTES DE LA CORRECCIÓN:');
        console.log(`  Cuota #1 paidAmount: ${quota1.paidAmount}`);
        console.log(`  Cuota #1 paidInterest: ${quota1.paidInterest}`);
        console.log(`  Cuota #1 status: ${quota1.status}`);
        console.log(`  Loan lateFee: ${loan.lateFee || 0}\n`);

        // CORRECCIÓN: Aplicar los 25 pesos de mora al interés
        quota1.paidAmount = 500; // Total pagado
        quota1.paidInterest = 500; // Todo fue a interés
        quota1.paidCapital = 0; // Nada a capital (rédito)
        quota1.status = 'paid'; // Marcar como pagada
        quota1.paidDate = new Date('2025-12-01T00:00:00Z'); // Fecha del pago

        // Resetear mora
        loan.lateFee = 0;
        loan.status = 'active'; // Ya no está past_due

        // Guardar
        loan.markModified('schedule');
        await loan.save();

        console.log('DESPUÉS DE LA CORRECCIÓN:');
        console.log(`  Cuota #1 paidAmount: ${quota1.paidAmount}`);
        console.log(`  Cuota #1 paidInterest: ${quota1.paidInterest}`);
        console.log(`  Cuota #1 status: ${quota1.status}`);
        console.log(`  Loan lateFee: ${loan.lateFee || 0}`);
        console.log(`  Loan status: ${loan.status}\n`);

        // CREAR LA TRANSACCIÓN FALTANTE
        let wallet = await Wallet.findOne({ businessId: user.businessId, isDefault: true });

        if (!wallet) {
            console.log('   No hay wallet, creando una...');
            wallet = await Wallet.create({
                businessId: user.businessId,
                name: 'Caja Principal',
                balance: 0,
                isDefault: true
            });
        }

        const transaction = new Transaction({
            type: 'in_payment',
            amount: 500,
            category: 'Pago Préstamo',
            description: `Pago Préstamo #${loan._id.toString().slice(-6)} (Corrección)`,
            client: loan.client._id,
            wallet: wallet._id,
            loan: loan._id,
            businessId: user.businessId,
            date: new Date('2025-12-01T00:00:00Z'),
            metadata: {
                loanId: loan._id,
                breakdown: {
                    interest: 500,
                    capital: 0,
                    mora: 0
                }
            }
        });

        await transaction.save();

        console.log('✅ Transacción creada:');
        console.log(`   ID: ${transaction._id}`);
        console.log(`   Monto: ${transaction.amount}`);
        console.log(`   Mora: 0 (corregido)`);
        console.log(`   Interés: 500`);
        console.log(`   Capital: 0\n`);

        console.log('🎉 CORRECCIÓN COMPLETADA\n');
        console.log('Por favor, recarga la página para ver los cambios.');

        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

correctJoseRamonPayment();
