const mongoose = require('mongoose');
const Loan = require('./models/Loan');
const Transaction = require('./models/Transaction');
const Client = require('./models/Client');
const User = require('./models/User');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/korion')
    .then(() => console.log('✅ MongoDB conectado'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const auditSystem = async () => {
    try {
        const user = await User.findOne({ email: 'starlyn_acevedo024@hotmail.com' });
        const loans = await Loan.find({ businessId: user.businessId }).populate('client');
        const transactions = await Transaction.find({ businessId: user.businessId }).sort({ date: 1 });

        console.log('═══════════════════════════════════════');
        console.log('📊 AUDITORÍA DEL SISTEMA');
        console.log('═══════════════════════════════════════');
        console.log(`Total Préstamos: ${loans.length}`);
        console.log(`Total Transacciones: ${transactions.length}`);
        console.log('═══════════════════════════════════════\n');

        let issuesFound = 0;
        const loanMap = new Map();

        // 1. VERIFICAR PRÉSTAMOS (Dispersión y Pagos)
        console.log('🔍 VERIFICANDO PRÉSTAMOS INDIVIDUALES:');

        for (const loan of loans) {
            loanMap.set(loan._id.toString(), loan);

            const clientName = loan.client?.name || 'Desconocido';
            const shortId = loan._id.toString().slice(-6);

            // Buscar Transacción de Desembolso (out_loan)
            const disbursementTx = transactions.find(tx =>
                tx.type === 'out_loan' &&
                (
                    (tx.loan && tx.loan.toString() === loan._id.toString()) ||
                    (tx.metadata?.loanId && tx.metadata.loanId.toString() === loan._id.toString())
                )
            );

            // Buscar Transacciones de Pago (in_payment)
            const paymentTxs = transactions.filter(tx =>
                tx.type === 'in_payment' &&
                (
                    (tx.loan && tx.loan.toString() === loan._id.toString()) ||
                    (tx.metadata?.loanId && tx.metadata.loanId.toString() === loan._id.toString())
                )
            );

            const totalPaidInTxs = paymentTxs.reduce((sum, tx) => sum + tx.amount, 0);

            // Calcular lo pagado según el Schedule
            const totalPaidInSchedule = loan.schedule.reduce((sum, q) => sum + (q.paidAmount || 0), 0);

            let status = '✅ OK';
            let notes = [];

            // Check Disbursement
            if (!disbursementTx) {
                status = '⚠️ ALERTA';
                notes.push('Falta transacción de desembolso');
                issuesFound++;
            } else if (disbursementTx.amount !== loan.amount) {
                status = '⚠️ ALERTA';
                notes.push(`Monto desembolso difiere: Tx=${disbursementTx.amount} vs Loan=${loan.amount}`);
                issuesFound++;
            }

            // Check Payments Consistency (Tx vs Schedule)
            // Note: Schedule paidAmount might include interest/capital split logic, but total should match roughly
            // unless there are manual adjustments or "mora" handling differences.
            // We know we fixed some mora issues where tx amount included mora but schedule didn't reflect it fully or vice versa.

            if (Math.abs(totalPaidInTxs - totalPaidInSchedule) > 1) { // Allow 1 peso diff for rounding
                status = '⚠️ ALERTA';
                notes.push(`Diferencia en Pagos: Txs=${totalPaidInTxs} vs Schedule=${totalPaidInSchedule}`);
                issuesFound++;
            }

            if (status !== '✅ OK') {
                console.log(`\n📌 Préstamo #${shortId} (${clientName})`);
                console.log(`   Estado: ${status}`);
                notes.forEach(n => console.log(`   - ${n}`));
                console.log(`   Transacciones de Pago: ${paymentTxs.length} (Total: ${totalPaidInTxs})`);
            }
        }

        // 2. VERIFICAR TRANSACCIONES HUÉRFANAS
    console.log('\n🔍 BUSCANDO TRANSACCIONES HUÉRFANAS:');
    console.log(`Loans in Map: ${loanMap.size}`);
    // console.log('Map Keys:', Array.from(loanMap.keys()));
    
    for (const tx of transactions) {
        if (tx.type === 'in_payment' || tx.type === 'out_loan') {
            let loanId = tx.loan ? tx.loan.toString() : null;
            if (!loanId && tx.metadata && tx.metadata.loanId) {
                loanId = tx.metadata.loanId.toString();
            }
            
            if (!loanId) {
                console.log(`⚠️ Tx Huérfana (Sin ID de Préstamo): ${tx._id} - ${tx.type} - $${tx.amount} - ${tx.description}`);
                issuesFound++;
                continue;
            }

            const loan = loanMap.get(loanId);
            if (!loan) {
                // Check if it's a deleted loan (maybe we can't know for sure, but it's an issue for consistency)
                console.log(`⚠️ Tx Huérfana (Préstamo No Existe en Map): ${tx._id} - ${tx.type} - $${tx.amount} - LoanID: ${loanId} - ${tx.description}`);
                // console.log(`   Looking for: ${loanId} (Type: ${typeof loanId})`);
                issuesFound++;
            }
        }
    }

        console.log('\n═══════════════════════════════════════');
        console.log(`RESUMEN: ${issuesFound} problemas encontrados.`);
        console.log('═══════════════════════════════════════');

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

auditSystem();
