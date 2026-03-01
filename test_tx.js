const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

mongoose.connect(process.env.MONGO_URI, { dbName: 'test' }).then(async () => {
  const LoanV3 = require('./models/LoanV3.js');
  
  const loanId = "6927e04d312573d65d1d4590";
  const loan = await LoanV3.findById(loanId).lean();
  
  if(!loan) {
      console.log("No loan");
      process.exit(1);
  }

  console.log("=== ESTADO ACTUAL DE LAS CUOTAS 1 a 6 ===");
  for (let i = 0; i < 6; i++) {
     let q = loan.schedule[i];
     const amount = q.amount?.$numberDecimal || q.amount;
     const paid = q.paidAmount?.$numberDecimal || q.paidAmount;
     console.log(`Cuota ${q.number} | Estado: ${q.status} | Monto: ${amount} | Pagado: ${paid}`);
  }

  process.exit(0);
});
