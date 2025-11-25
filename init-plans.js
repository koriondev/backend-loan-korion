require('dotenv').config();
const mongoose = require('mongoose');

// Esquema temporal para asegurarnos que coincida
const PlanSchema = new mongoose.Schema({
  code: String,
  name: String,
  price: Number,
  limits: {
    maxLoans: Number,
    maxUsers: Number,
    maxRoutes: Number,
    maxWallets: Number
  },
  features: Object
});

const Plan = mongoose.model('Plan', PlanSchema);

// Conexión Base de Datos
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('🔌 Conectado a Mongo. Borrando planes viejos...');

    try {
      await Plan.deleteMany({});

      console.log('🌱 Insertando 4 Planes Nuevos...');

      const plans = [
        {
          code: 'free',
          name: 'Gratis (Demo)',
          price: 0,
          limits: { maxLoans: 5, maxUsers: 1, maxRoutes: 0, maxWallets: 1 },
          features: { allowWhatsapp: false, allowMaps: false }
        },
        {
          code: 'basic',
          name: 'Básico',
          price: 20,
          limits: { maxLoans: 100, maxUsers: 2, maxRoutes: 2, maxWallets: 2 },
          features: { allowWhatsapp: false, allowMaps: false }
        },
        {
          code: 'pro',
          name: 'Profesional',
          price: 60,
          limits: { maxLoans: 500, maxUsers: 6, maxRoutes: 10, maxWallets: 5 },
          features: { allowWhatsapp: true, allowMaps: true }
        },
        {
          code: 'enterprise',
          name: 'Empresarial',
          price: 100,
          limits: { maxLoans: 2000, maxUsers: 15, maxRoutes: 99, maxWallets: 20 },
          features: { allowWhatsapp: true, allowMaps: true }
        }
      ];

      await Plan.insertMany(plans);
      console.log('✅ ¡ÉXITO! 4 Planes insertados correctamente.');
      console.log('Ahora reinicia tu backend y recarga la web.');
      process.exit(0);

    } catch (error) {
      console.error('❌ Error insertando:', error);
      process.exit(1);
    }
  })
  .catch(err => console.error('❌ Error de conexión:', err));