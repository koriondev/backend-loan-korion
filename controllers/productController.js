const Product = require('../models/Product');

// 1. OBTENER PRODUCTOS (HÍBRIDO)
exports.getProducts = async (req, res) => {
  try {
    // Buscar productos que:
    // A) Sean de mi empresa (businessId match)
    // B) O sean globales (isGlobal: true)
    const filter = {
        $or: [
            { businessId: req.user.businessId },
            { isGlobal: true }
        ],
        isActive: true
    };

    const products = await Product.find(filter).sort({ isGlobal: -1, name: 1 }); // Globales primero
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 2. CREAR PRODUCTO
exports.createProduct = async (req, res) => {
  try {
    const { name, interestRate, duration, frequency, interestType } = req.body;
    
    // Si el que crea es TI, es Global. Si es Admin, es Privado.
    const isGlobal = req.user.role === 'ti';

    const newProduct = new Product({
      name,
      interestRate,
      duration,
      frequency,
      interestType,
      isGlobal,
      businessId: isGlobal ? null : req.user.businessId // TI no tiene businessId
    });

    await newProduct.save();
    res.status(201).json(newProduct);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};