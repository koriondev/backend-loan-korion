/**
 * Role-based access control middleware
 * @param {Array|String} roles - Allowed roles for this route
 */
const roleMiddleware = (roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: 'No autenticado' });
        }

        const allowedRoles = Array.isArray(roles) ? roles : [roles];

        if (!allowedRoles.includes(req.user.role)) {
            console.warn(`[ACCESO DENEGADO] Intento de acceso a ruta protegida por parte de: ${req.user.email || req.user.id} con rol: ${req.user.role}`);
            return res.status(403).json({
                success: false,
                message: 'No tiene los permisos suficientes (Acceso restringido a Superadmin/TI)'
            });
        }

        next();
    };
};

module.exports = roleMiddleware;
