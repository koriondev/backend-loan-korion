const express = require('express');
const router = express.Router();
const Client = require('../models/Client');
const User = require('../models/User');

// 1. Obtener Cobradores (Para el dropdown)
router.get('/collectors', async (req, res) => {
  try {
    const collectors = await User.find({ role: 'collector' }).select('name email');
    res.json(collectors);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Obtener Ruta de un Cobrador
router.get('/:collectorId', async (req, res) => {
  try {
    const clients = await Client.find({ assignedTo: req.params.collectorId })
      .sort({ visitOrder: 1 }); // Ordenados por la secuencia definida
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Guardar/Optimizar Ruta (Actualización Masiva)
router.put('/assign', async (req, res) => {
  try {
    const { collectorId, clients } = req.body; // clients es un array de IDs en orden

    // Actualizamos cada cliente con su nuevo orden y cobrador
    const updates = clients.map((clientId, index) => {
      return Client.findByIdAndUpdate(clientId, {
        assignedTo: collectorId,
        visitOrder: index + 1
      });
    });

    await Promise.all(updates);
    res.json({ message: "Ruta actualizada exitosamente" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;