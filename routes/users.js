const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');

// Middlewares de seguridad y límites
const authMiddleware = require('../middleware/authMiddleware'); 
const limitMiddleware = require('../middleware/limitMiddleware');

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
router.post('/', limitMiddleware.checkUserLimit, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    // Validaciones básicas
    if (!req.user.businessId && req.user.role !== 'ti') {
        return res.status(403).json({ error: "No tienes una empresa asignada para crear usuarios." });
    }

    // Validar si ya existe el correo
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "El correo ya está registrado" });

    // Encriptar password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      role,
      businessId: req.user.businessId // <--- ASIGNACIÓN AUTOMÁTICA AL NEGOCIO
    });

    await newUser.save();
    
    // Devolver sin password
    const userResponse = newUser.toObject();
    delete userResponse.password;
    
    res.status(201).json(userResponse);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. ELIMINAR USUARIO
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