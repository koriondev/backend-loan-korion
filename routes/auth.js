const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');

// CLAVE SECRETA
// CLAVE SECRETA
// CLAVE SECRETA
if (!process.env.JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is not defined.');
}
const JWT_SECRET = process.env.JWT_SECRET;

// 1. REGISTRAR USUARIO
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    // Encriptar password solo si viene, si no status es pending_activation
    let hashedPassword = null;
    let initialStatus = 'active';

    if (password && password.trim().length > 0) {
      const salt = await bcrypt.genSalt(10);
      hashedPassword = await bcrypt.hash(password, salt);
    } else {
      initialStatus = 'pending_activation';
    }

    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      role,
      status: initialStatus,
      isActive: initialStatus === 'active'
    });

    await newUser.save();
    res.json({ message: "Usuario creado con éxito", status: initialStatus });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. PRE-LOGIN (Verificar estado del usuario)
router.post('/pre-login', async (req, res) => {
  try { // Added try-catch block for pre-login
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      console.log(`Pre-login check failed: User ${email} not found`);
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const requiresSetup = user.status === 'pending_activation' || !user.password || user.password === '';

    console.log(`[Auth] Pre-login check for ${email}:`);
    console.log(`  - Status: ${user.status}`);
    console.log(`  - Has Password: ${!!user.password}`);
    console.log(`  - Requires Setup: ${requiresSetup}`);

    // Generar token de activación temporal para seguridad si requiere setup
    let activationToken = null;
    if (requiresSetup) {
      activationToken = jwt.sign({ email: user.email, action: 'activate' }, JWT_SECRET, { expiresIn: '15m' });
    }

    res.json({
      requiresSetup,
      name: user.name,
      activationToken // Se usará en el siguiente paso para /activate
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. ACTIVAR CUENTA (Establecer contraseña por primera vez)
router.post('/activate', async (req, res) => {
  try {
    const { email, password, token } = req.body;

    // Verificar token de seguridad
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.email !== email || decoded.action !== 'activate') {
        return res.status(401).json({ message: "Token de activación inválido o expirado" });
      }
    } catch (err) {
      return res.status(401).json({ message: "Token de activación inválido o expirado" });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "Usuario no encontrado" });

    // Encriptar nueva contraseña
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    user.status = 'active';
    user.isActive = true;

    await user.save();

    // Generar login automático tras activación
    const loginToken = jwt.sign(
      { id: user._id, role: user.role, businessId: user.businessId },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({
      message: "Cuenta activada con éxito",
      token: loginToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        businessId: user.businessId
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. LOGIN (CORREGIDO)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Usuario no encontrado" });

    if (user.status === 'pending_activation') {
      return res.status(400).json({ message: "Esta cuenta aún no ha sido activada. Por favor, inicia el flujo de activación." });
    }

    if (user.status === 'suspended' || !user.isActive) {
      return res.status(403).json({ message: "Cuenta suspendida. Contacta al administrador." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Contraseña incorrecta" });

    // Crear Token
    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
        businessId: user.businessId
      },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Obtener configuración y datos del negocio
    const Business = require('../models/Business');
    const Settings = require('../models/Settings');

    const [business, settings] = await Promise.all([
      Business.findById(user.businessId),
      Settings.findOne({ businessId: user.businessId })
    ]);

    const enabledModules = settings ? settings.enabledModules : [];

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        businessId: user.businessId,
        enabledModules,
        // Datos de suscripción
        isDemo: business?.isDemo || false,
        demoExpirationDate: business?.demoExpirationDate,
        modulePermissions: business?.modulePermissions || []
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. VALIDAR SESIÓN
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');

    const Business = require('../models/Business');
    const Settings = require('../models/Settings');

    const [business, settings] = await Promise.all([
      Business.findById(user.businessId),
      Settings.findOne({ businessId: user.businessId })
    ]);

    const enabledModules = settings ? settings.enabledModules : [];

    // Return user object + enabledModules + Subscription data
    res.json({
      ...user.toObject(),
      enabledModules,
      isDemo: business?.isDemo || false,
      demoExpirationDate: business?.demoExpirationDate,
      modulePermissions: business?.modulePermissions || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;