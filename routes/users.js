const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');

// Middlewares de seguridad y límites
const authMiddleware = require('../middleware/authMiddleware');
const subscriptionMiddleware = require('../middleware/subscriptionMiddleware');

// 🔒 PROTEGER TODAS LAS RUTAS (Solo usuarios logueados pueden gestionar usuarios)
router.use(authMiddleware);

// 1. LISTAR USUARIOS (Solo de mi empresa)
router.get('/', async (req, res) => {
  try {
    // req.businessFilter viene del authMiddleware (automáticamente filtra por tu empresa)
    const users = await User.find(req.businessFilter)
      .select('-password')
      .sort({ createdAt: -1 });

    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. CREAR NUEVO USUARIO (Con validación de límites del Plan)
router.post('/',
  subscriptionMiddleware.checkSubscription,
  subscriptionMiddleware.checkModuleAccess('multiusuario'), // <--- Ejemplo de permiso modular
  async (req, res) => {
    try {
      const { name, email, password, role } = req.body;

      // Validaciones básicas
      if (!req.user.businessId && req.user.role !== 'ti') {
        return res.status(403).json({ error: "No tienes una empresa asignada para crear usuarios." });
      }

      // Validar si ya existe el correo
      const existingUser = await User.findOne({ email });
      if (existingUser) return res.status(400).json({ message: "El correo ya está registrado" });

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
        password: hashedPassword || null, // EXPLICIT NULL
        role,
        status: initialStatus,
        isActive: initialStatus === 'active', // Only active if it has a password
        businessId: req.user.businessId // <--- ASIGNACIÓN AUTOMÁTICA AL NEGOCIO
      });

      console.log(`[Users] Creating user ${email} with status ${initialStatus}. Has password: ${!!hashedPassword}`);

      await newUser.save();

      // Devolver sin password
      const userResponse = newUser.toObject();
      delete userResponse.password;

      res.status(201).json(userResponse);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

// 3. ACTUALIZAR USUARIO
router.put('/:id', async (req, res) => {
  try {
    const { name, email, role, defaultSharePercentage, password } = req.body;

    // Asegurar que solo edito usuarios de MI empresa
    const userToUpdate = await User.findOne({ _id: req.params.id, ...req.businessFilter });
    if (!userToUpdate) {
      return res.status(404).json({ message: "Usuario no encontrado o no tienes permiso." });
    }

    // Actualizar campos permitidos
    if (name) userToUpdate.name = name;
    if (email) userToUpdate.email = email;
    if (role) userToUpdate.role = role;
    if (defaultSharePercentage !== undefined) userToUpdate.defaultSharePercentage = defaultSharePercentage;

    // Si envían password, encriptar y actualizar
    if (password && password.trim().length > 0) {
      const salt = await bcrypt.genSalt(10);
      userToUpdate.password = await bcrypt.hash(password, salt);
    }

    await userToUpdate.save();

    const userResponse = userToUpdate.toObject();
    delete userResponse.password;

    res.json(userResponse);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. ELIMINAR USUARIO
router.delete('/:id', async (req, res) => {
  try {
    // Asegurar que solo borro usuarios de MI empresa
    const userToDelete = await User.findOne({ _id: req.params.id, ...req.businessFilter });

    if (!userToDelete) {
      return res.status(404).json({ message: "Usuario no encontrado o no tienes permiso." });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "Usuario eliminado" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;