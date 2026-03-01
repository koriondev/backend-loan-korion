const Business = require('../models/Business');
const Client = require('../models/Client');
const Loan = require('../models/Loan');
const User = require('../models/User');

/**
 * Middleware para validar el estado de la suscripción y límites
 */

// 1. Validar Expiración (Demo o Licencia)
exports.checkSubscription = async (req, res, next) => {
    try {
        const { businessId } = req.user;
        if (!businessId) return next(); // Los usuarios TI no tienen negocio

        const business = await Business.findById(businessId);
        if (!business) return res.status(404).json({ error: "Negocio no encontrado" });

        const now = new Date();

        // Verificar Expiración de Demo
        if (business.isDemo && business.demoExpirationDate) {
            if (now > business.demoExpirationDate) {
                return res.status(403).json({
                    error: "Tu período de prueba ha expirado.",
                    code: "EXPIRATION_DEMO"
                });
            }
        }

        // Prioridad: Fecha de Expiración > Status
        const isExpiredByDate = (business.licenseExpiresAt && now > business.licenseExpiresAt);
        const isExpiredByStatus = (business.status === 'expired');

        if (isExpiredByStatus || isExpiredByDate) {
            return res.status(403).json({
                error: "Tu suscripción ha expirado. Por favor, realiza el pago para continuar.",
                code: "EXPIRATION_LICENSE"
            });
        }

        if (business.status === 'suspended') {
            return res.status(403).json({ error: "Cuenta suspendida o inhabilitada temporalmente." });
        }

        req.businessData = business; // Guardar para uso posterior
        next();
    } catch (error) {
        console.error('❌ [SUBSCRIPTION] Error checkSubscription:', error);
        res.status(500).json({ error: "Error al validar la suscripción." });
    }
};

// 2. Validar Límite de Clientes
exports.checkClientLimit = async (req, res, next) => {
    try {
        const business = req.businessData || await Business.findById(req.user.businessId);
        const limit = business.limits?.maxClients || 5; // Default demo limit

        const currentCount = await Client.countDocuments({ businessId: business._id });

        if (currentCount >= limit) {
            return res.status(403).json({
                error: `Límite de clientes alcanzado (${limit}). Actualiza tu plan para registrar más.`,
                code: "LIMIT_CLIENTS_REACHED"
            });
        }
        next();
    } catch (error) {
        console.error('❌ [SUBSCRIPTION] Error checkClientLimit:', error);
        res.status(500).json({ error: "Error al verificar límites de clientes." });
    }
};

// 3. Validar Límite de Préstamos
exports.checkLoanLimit = async (req, res, next) => {
    try {
        const business = req.businessData || await Business.findById(req.user.businessId);
        const limit = business.limits?.maxLoans || 5;

        // Solo contamos préstamos ACTIVOS para el límite
        const currentCount = await Loan.countDocuments({
            businessId: business._id,
            status: { $in: ['active', 'past_due'] }
        });

        if (currentCount >= limit) {
            return res.status(403).json({
                error: `Límite de préstamos activos alcanzado (${limit}). Actualiza tu plan.`,
                code: "LIMIT_LOANS_REACHED"
            });
        }
        next();
    } catch (error) {
        console.error('❌ [SUBSCRIPTION] Error checkLoanLimit:', error);
        res.status(500).json({ error: "Error al verificar límites de préstamos." });
    }
};

// 4. Validar Acceso a Módulos
exports.checkModuleAccess = (moduleName) => {
    return async (req, res, next) => {
        try {
            const business = req.businessData || await Business.findById(req.user.businessId);

            // Si es TI, tiene acceso a todo
            if (req.user.role === 'ti') return next();

            const permissions = business.modulePermissions || [];
            if (!permissions.includes(moduleName)) {
                return res.status(403).json({
                    error: `El módulo '${moduleName}' no está incluido en tu plan actual.`,
                    code: "MODULE_ACCESS_DENIED"
                });
            }
            next();
        } catch (error) {
            console.error('❌ [SUBSCRIPTION] Error checkModuleAccess:', error);
            res.status(500).json({ error: "Error al validar acceso a módulos." });
        }
    };
};
