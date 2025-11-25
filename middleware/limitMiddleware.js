const Business = require('../models/Business');
const Plan = require('../models/Plan');
const Loan = require('../models/Loan');
const User = require('../models/User');

// Verificar Límite de Préstamos
exports.checkLoanLimit = async (req, res, next) => {
  try {
    const businessId = req.user.businessId;
    // Buscar negocio y su plan
    const business = await Business.findById(businessId).populate('planId');
    
    if (!business || !business.planId) return res.status(403).json({ error: "Sin plan asignado" });

    const limit = business.planId.limits.maxLoans;
    const currentCount = await Loan.countDocuments({ businessId: businessId, status: 'active' });

    if (currentCount >= limit) {
      return res.status(403).json({ 
        error: `Has alcanzado el límite de ${limit} préstamos activos de tu plan ${business.planId.name}. Actualiza tu plan.` 
      });
    }
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Verificar Límite de Usuarios
exports.checkUserLimit = async (req, res, next) => {
  try {
    const businessId = req.user.businessId;
    const business = await Business.findById(businessId).populate('planId');
    
    const limit = business.planId.limits.maxUsers;
    const currentCount = await User.countDocuments({ businessId: businessId });

    if (currentCount >= limit) {
      return res.status(403).json({ 
        error: `Límite de usuarios (${limit}) alcanzado. Contacta a soporte para ampliar.` 
      });
    }
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};