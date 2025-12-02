const mongoose = require('mongoose');
const User = require('./models/User');
const Loan = require('./models/Loan');
const Transaction = require('./models/Transaction');
const Wallet = require('./models/Wallet');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
  .then(() => console.log('✅ MongoDB conectado'))
  .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const generateTransactions = async () => {
  try {
    const user = await User.findOne({ email: 'duartecoronajeffrynoel@gmail.com' });
    if (!user) {
      console.error('❌ Usuario no encontrado');
      process.exit(1);
    }

    const businessId = user.businessId;
    console.log(`✅ Usuario: ${user.name}\n`);

    // Get all loans for this business
    const loans = await Loan.find({ businessId }).populate('client');
    console.log(`📋 Procesando ${loans.length} préstamos...\n`);

    // Get default wallet
    const wallet = await Wallet.findOne({ businessId, isDefault: true });
    if (!wallet) {
      console.error('❌ No se encontró wallet');
      process.exit(1);
    }

    const transactions = [];
    let totalTransactions = 0;

    for (const loan of loans) {
      // Find paid quotas
      const paidQuotas = loan.schedule.filter(q => q.status === 'paid' && q.paidDate);
      
      if (paidQuotas.length === 0) continue;

      console.log(`  📄 ${loan.client.name}: ${paidQuotas.length} cuotas pagadas`);

      for (const quota of paidQuotas) {
        // Create transaction for this payment
        const transaction = {
          businessId,
          wallet: wallet._id,
          client: loan.client._id,
          loan: loan._id,
          type: 'in_payment',
          category: 'in_payment',
          amount: quota.paidAmount || quota.amount,
          date: quota.paidDate,
          description: `Pago cuota #${quota.number} - Préstamo ${loan._id.toString().slice(-6)}`,
          metadata: {
            loanId: loan._id,
            quotaNumber: quota.number,
            breakdown: {
              appliedToInterest: quota.paidInterest || 0,
              appliedToCapital: quota.paidCapital || 0,
              appliedToMora: 0
            }
          }
        };

        transactions.push(transaction);
        totalTransactions++;
      }
    }

    if (transactions.length > 0) {
      console.log(`\n💾 Guardando ${transactions.length} transacciones...`);
      await Transaction.insertMany(transactions);
      console.log(`✅ ${transactions.length} transacciones creadas exitosamente`);
    } else {
      console.log('\n⚠️  No hay cuotas pagadas para generar transacciones');
    }

    console.log('\n✅ Proceso completado');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error);
    console.error(error.stack);
    process.exit(1);
  }
};

generateTransactions();
