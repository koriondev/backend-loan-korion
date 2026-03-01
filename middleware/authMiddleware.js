const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) return res.status(401).json({ message: 'Acceso denegado.' });

  try {
    const secret = process.env.JWT_SECRET || 'korion_secret_key_123';
    const verified = jwt.verify(token, secret);
    req.user = verified; // Aquí viene { id, role, businessId }

    // Lógica de Inyección de Scope (Alcance)
    // Esto ayuda a los controladores a filtrar automáticamente
    if (['ti', 'superadmin'].includes(req.user.role)) {
      // El TI o Superadmin puede enviar un header 'x-business-id' para actuar en nombre de una empresa
      // Si no lo envía, es modo global
      req.businessFilter = req.headers['x-business-id'] ? { businessId: req.headers['x-business-id'] } : {};
    } else {
      // Usuarios normales SIEMPRE filtran por su negocio
      req.businessFilter = { businessId: req.user.businessId };
    }

    next();
  } catch (error) {
    res.status(400).json({ message: 'Token inválido.' });
  }
};

module.exports = authMiddleware;