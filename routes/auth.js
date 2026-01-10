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

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      role
    });

    await newUser.save();
    res.json({ message: "Usuario creado con éxito" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. LOGIN (CORREGIDO)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Usuario no encontrado" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Contraseña incorrecta" });

    // ... dentro de router.post('/login') ...

    // Crear Token (El pase VIP)
    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
        businessId: user.businessId // <--- ¡ESTA LÍNEA ES LA QUE HACE LA MAGIA!
      },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Obtener configuración de la empresa para saber qué módulos están activos
    const Settings = require('../models/Settings');
    const settings = await Settings.findOne({ businessId: user.businessId });
    const enabledModules = settings ? settings.enabledModules : [];

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        businessId: user.businessId,
        enabledModules // <--- Enviamos los módulos permitidos
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

    // Fetch settings to include enabledModules
    const Settings = require('../models/Settings');
    const settings = await Settings.findOne({ businessId: user.businessId });
    const enabledModules = settings ? settings.enabledModules : [];

    // Return user object + enabledModules
    res.json({
      ...user.toObject(),
      enabledModules
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;