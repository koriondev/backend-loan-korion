require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// --- 1. IMPORTAR RUTAS ---
const productRoutes = require('./routes/products');
const authRoutes = require('./routes/auth');
const clientRoutes = require('./routes/clients');
const activityRoutes = require('./routes/activity');
// const dashboardRoutes = require('./routes/dashboard'); // Si existe
const loanRoutes = require('./routes/loans');
const financeRoutes = require('./routes/finance');
const reportRoutes = require('./routes/reports');
const notificationRoutes = require('./routes/notifications'); // Added notification routes import
const settingsRoutes = require('./routes/settings');
const userRoutes = require('./routes/users');
const platformRoutes = require('./routes/platform'); // <--- ESTA FALTABA O ESTABA MAL

const app = express();

// --- SEGURIDAD: Helmet (Cabeceras HTTP seguras) ---
app.use(helmet({
  contentSecurityPolicy: false, // Deshabilitar CSP para no romper el frontend; configurar por separado si se necesita
}));

// --- CORS CONFIGURATION (MUST BE BEFORE RATE LIMITERS) ---
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:5173'];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Intento de acceso bloqueado desde: ${origin}`);
      callback(new Error('Bloqueado por CORS'));
    }
  },
  credentials: true
}));

// --- SEGURIDAD: Rate Limiting Global ---
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 300, // Máximo 300 peticiones por IP cada 15 minutos
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Por favor, intenta de nuevo en 15 minutos.' }
});
app.use('/api/', globalLimiter);

// --- SEGURIDAD: Rate Limiting estricto para autenticación ---
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 20, // Máximo 20 intentos de login por IP cada 15 minutos
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de autenticación. Por favor, intenta de nuevo en 15 minutos.' }
});
app.use('/api/auth/', authLimiter);



app.use(express.json());

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- 2. CONECTAR RUTAS (ENDPOINTS) ---
app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/activity', activityRoutes);

// Loans - UNIFIED Core (V3)
app.use('/api/loans', loanRoutes);
app.use('/api/v2/loans', loanRoutes); // Legacy Support
app.use('/api/v3/loans', loanRoutes); // Legacy Support

app.use('/api/finance', financeRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/config', settingsRoutes);
app.use('/api/users', userRoutes);
app.use('/api/platform', platformRoutes); // SaaS Platform Logic
app.use('/api/products', productRoutes);  // SaaS Product Logic
app.use('/api/telegram', require('./routes/telegram')); // Telegram Bot Integration

// Inicializar Background Services (Event Listeners)
require('./services/telegramNotificationService');

// Ruta base de prueba
app.get('/', (req, res) => {
  res.send('Backend Korionloan Activo v3.0 (SaaS)');
});

// --- 3. MIDDLEWARE DE MANEJO DE ERRORES GLOBAL ---
app.use((err, req, res, next) => {
  console.error(`[SERVIDOR] Error detectado: ${err.message}`);
  // Registramos el error completo solo en los logs internos del EC2
  console.error(err.stack);

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    error: 'Error interno del servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Algo salió mal. Por favor, contacte a soporte si el problema persiste.'
  });
});

// --- 4. CONEXIÓN A BASE DE DATOS Y ARRANQUE ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/korionloan';
const PORT = process.env.PORT || 5000;

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('---------------------------------------');
    console.log('🟢 MongoDB Conectado Exitosamente');
    console.log(`🏠 HOST: ${mongoose.connection.host}`);
    console.log(`🗄️  BASE: ${mongoose.connection.name}`);
    console.log('---------------------------------------');

    // Inicializar Scheduler solo después de conectar a la DB
    const initScheduler = require('./services/schedulerService');
    initScheduler();

    // Iniciar Servidor
    app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en puerto ${PORT}`);

      // Keep Alive (Optimization - Production Only)
      if (process.env.NODE_ENV === 'production') {
        try {
          // require('./services/keep_alive')();
          console.log('⏰ Keep-Alive Service Standby');
        } catch (e) {
          console.error('Error starting Keep-Alive:', e);
        }
      }
    });
  })
  .catch(err => {
    console.error('� Error Grave de Conexión Mongo:', err);
    process.exit(1);
  });