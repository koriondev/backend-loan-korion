const mongoose = require('mongoose');
require('dotenv').config({ path: '.env' }); // Adjusted path for script

const uri = process.env.MONGO_URI;

async function unifyLoans() {
    console.log("🚀 Iniciando unificación de colección Loans...");

    try {
        await mongoose.connect(uri);
        console.log("🟢 Conectado a MongoDB");

        const db = mongoose.connection.db;

        const loansCol = db.collection('loans');
        const loanV2sCol = db.collection('loanv2');
        const loanV3sCol = db.collection('loanv3');

        // Paso 0: Contar para verificación inicial
        const initialV1Count = await loansCol.countDocuments();

        let initialV2Count = 0;
        try { initialV2Count = await loanV2sCol.countDocuments(); } catch (e) { }

        let initialV3Count = 0;
        try { initialV3Count = await loanV3sCol.countDocuments(); } catch (e) { }

        console.log(`📊 Conteo Inicial: V1 (${initialV1Count}), V2 (${initialV2Count}), V3 (${initialV3Count})`);
        const totalExpected = initialV1Count + initialV2Count + initialV3Count;

        // Paso 1: Actualizar todos los V1 en la colección loans con version: 1 y asegurar clientId
        const updateV1Result = await loansCol.updateMany(
            {},
            { $set: { version: 1 } }
        );
        // Copy "client" to "clientId" directly in the database to avoid Mongoose required validation failure
        await loansCol.updateMany(
            { client: { $exists: true }, clientId: { $exists: false } },
            [{ $set: { clientId: "$client" } }]
        );
        console.log(`✅ Fase 1 Completada: ${updateV1Result.modifiedCount} V1 document(s) actualizados con version: 1.`);

        // Paso 2: Migrar LoanV2
        if (initialV2Count > 0) {
            const v2Loans = await loanV2sCol.find({}).toArray();
            const v2LoansToInsert = v2Loans.map(loan => ({ ...loan, version: 2 }));
            const v2InsertResult = await loansCol.insertMany(v2LoansToInsert);
            console.log(`✅ Fase 2 Completada: ${v2InsertResult.insertedCount} V2 document(s) insertados a loans.`);
        }

        // Paso 3: Migrar LoanV3
        if (initialV3Count > 0) {
            const v3Loans = await loanV3sCol.find({}).toArray();
            const v3LoansToInsert = v3Loans.map(loan => ({ ...loan, version: 3 }));
            const v3InsertResult = await loansCol.insertMany(v3LoansToInsert);
            console.log(`✅ Fase 3 Completada: ${v3InsertResult.insertedCount} V3 document(s) insertados a loans.`);
        }

        // Paso 4: Verificación Final
        const finalLoansCount = await loansCol.countDocuments();
        console.log(`📊 Conteo Final en colección loans: ${finalLoansCount} (Esperados: ${totalExpected})`);

        if (finalLoansCount === totalExpected) {
            console.log("🎉 ¡MIGRACIÓN EXITOSA! Los conteos coinciden perfectamente.");
            console.log("⚠️ Recuerda: Las colecciones 'loanv2s' y 'loanv3s' aún existen por precaución. Puedes eliminarlas manualmente luego de validar la funcionalidad.");
        } else {
            console.error("❌ ADVERTENCIA: Hay un desajuste en los números. Esperados vs Finales no coinciden.");
        }

    } catch (error) {
        console.error("🚨 Error durante la migración:", error);
    } finally {
        await mongoose.disconnect();
        process.exit();
    }
}

unifyLoans();
