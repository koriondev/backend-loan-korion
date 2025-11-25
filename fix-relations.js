require('dotenv').config();
const mongoose = require('mongoose');
const Business = require('./models/Business');
const User = require('./models/User');

mongoose.connect('mongodb://localhost:27017/korionloan')
  .then(async () => {
    console.log('🔧 Iniciando reparación de vínculos...');
    
    // 1. Traer todas las empresas
    const businesses = await Business.find();
    
    if (businesses.length === 0) {
        console.log('❌ No hay empresas. Ejecuta seed-saas.js primero.');
        process.exit();
    }

    for (const biz of businesses) {
      console.log(`\nProcesando empresa: ${biz.name} (${biz._id})`);
      
      // Buscar al dueño por email y forzar el businessId
      const owner = await User.findOne({ email: biz.ownerEmail });
      if (owner) {
        owner.businessId = biz._id;
        await owner.save();
        console.log(`   ✅ Dueño vinculado: ${owner.name}`);
      } else {
        console.log(`   ⚠️ No se encontró usuario dueño (${biz.ownerEmail})`);
      }

      // Buscar usuarios "huérfanos" que parezcan de esta empresa (por dominio de correo o nombre)
      // Opcional: Forzar actualización masiva si usaste el seed anterior
      // Esto busca usuarios cuyo email termine en el dominio del dueño (si aplica)
      // O simplemente cuenta cuántos hay ahora
      const count = await User.countDocuments({ businessId: biz._id });
      console.log(`   📊 Usuarios actuales en DB: ${count}`);
    }

    console.log('\n✅ Reparación terminada.');
    process.exit();
  })
  .catch(err => console.error(err));