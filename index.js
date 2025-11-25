require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

// --- 1. IMPORTAR RUTAS ---
const productRoutes = require('./routes/products');
const authRoutes = require('./routes/auth');
const clientRoutes = require('./routes/clients');
const loanRoutes = require('./routes/loans');
const financeRoutes = require('./routes/finance');
const reportRoutes = require('./routes/reports');
const settingsRoutes = require('./routes/settings');
const userRoutes = require('./routes/users');
const platformRoutes = require('./routes/platform'); // <--- ESTA FALTABA O ESTABA MAL

const app = express();

// Middlewares
const allowedOrigins = [
  'http://localhost:5173', // Tu entorno local
  'https://frontendkorion.netlify.app' // <--- TU URL DE NETLIFY (Copiada de tu imagen)
];

app.use(cors({
  origin: function (origin, callback) {
    // Permitir peticiones sin origen (como Postman) o si está en la lista blanca
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Bloqueado por CORS'));
    }
  },
  credentials: true // Permite envío de cookies/headers de autorización
}));

app.use(express.json());
// Conexión Base de Datos
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';

mongoose.connect(MONGO_URI)
  .then(() => console.log('🟢 MongoDB Conectado'))
  .catch(err => console.error('🔴 Error Mongo:', err));

// --- 2. CONECTAR RUTAS (ENDPOINTS) ---
app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/config', settingsRoutes);
app.use('/api/users', userRoutes);
app.use('/api/platform', platformRoutes); // <--- CONEXIÓN SAAS
app.use('/api/products', productRoutes); // <--- CONEXIÓN SAAS

// Ruta base de prueba
app.get('/', (req, res) => {
  res.send('Backend Korionloan Activo v3.0 (SaaS)');
});

// Iniciar Servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server en puerto ${PORT}`));