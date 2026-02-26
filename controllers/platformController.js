const Business = require('../models/Business');
const User = require('../models/User');
const Plan = require('../models/Plan');
const bcrypt = require('bcryptjs');
const Client = require('../models/Client');
const Loan = require('../models/Loan');
const Transaction = require('../models/Transaction');
const Wallet = require('../models/Wallet');

const generateSlug = (name) => {
  return name.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '') + '-' + Date.now().toString().slice(-4);
};

// 1. Listar Planes
exports.getPlans = async (req, res) => {
  try {
    const plans = await Plan.find().sort({ price: 1 });
    res.json(plans);
  } catch (error) { res.status(500).json({ error: error.message }); }
};

// 2. Crear Negocio
exports.createBusiness = async (req, res) => {
  try {
    const { businessName, planId, adminName, adminEmail, setupKey } = req.body;

    console.log('[DEBUG] Receiving request to create business:', {
      businessName,
      adminEmail,
      hasSetupKey: !!setupKey,
      setupKeyLength: setupKey?.length
    });

    if (!planId) return res.status(400).json({ error: "Plan requerido" });
    const selectedPlan = await Plan.findById(planId);

    const isDemo = selectedPlan.code === 'demo';
    const demoExpirationDate = isDemo ? new Date(new Date().setDate(new Date().getDate() + 5)) : null;

    const newBusiness = new Business({
      name: businessName,
      slug: generateSlug(businessName),
      ownerEmail: adminEmail,
      planId: selectedPlan._id,
      limits: selectedPlan.limits,
      modulePermissions: selectedPlan.modulePermissions || [], // Copiar permisos del plan
      isDemo,
      demoExpirationDate,
      licenseExpiresAt: new Date(new Date().setFullYear(new Date().getFullYear() + 1))
    });
    await newBusiness.save();

    // Encriptar password solo si viene, si no status es pending_activation
    let hashedPassword = null;
    let initialStatus = 'active';

    if (setupKey && typeof setupKey === 'string' && setupKey.trim().length > 0) {
      console.log(`[DEBUG] Hashing setupKey of length ${setupKey.length}`);
      const salt = await bcrypt.genSalt(10);
      hashedPassword = await bcrypt.hash(setupKey, salt);
    } else {
      console.log(`[DEBUG] No valid setupKey provided. Setting status to pending_activation. Type: ${typeof setupKey}`);
      initialStatus = 'pending_activation';
    }

    const adminUser = new User({
      name: adminName,
      email: adminEmail,
      password: hashedPassword || null,
      role: 'admin',
      businessId: newBusiness._id,
      status: initialStatus,
      isActive: initialStatus === 'active'
    });

    console.log(`[TI] Creating admin ${adminEmail}: status=${initialStatus}, hasPassword=${!!hashedPassword}`);
    await adminUser.save();

    res.status(201).json({ message: "Creado", businessId: newBusiness._id });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ error: "Nombre o email duplicado" });
    res.status(500).json({ error: error.message });
  }
};

// 3. Listar Negocios
exports.getAllBusinesses = async (req, res) => {
  try {
    const businesses = await Business.find().populate('planId').sort({ createdAt: -1 });
    const enriched = await Promise.all(businesses.map(async (biz) => {
      const userCount = await User.countDocuments({ businessId: biz._id });
      return {
        _id: biz._id, name: biz.name, owner: { email: biz.ownerEmail },
        license: { name: biz.planId?.name, price: biz.planId?.price, maxUsers: biz.limits?.maxUsers },
        stats: { usersActive: userCount }, status: biz.status
      };
    }));
    res.json(enriched);
  } catch (error) { res.status(500).json({ error: error.message }); }
};

// 4. ACTUALIZAR NEGOCIO (Esta es la que fallaba)
exports.updateBusiness = async (req, res) => {
  try {
    const { id } = req.params;
    const { planId, status, demoExpirationDate, licenseExpiresAt, modulePermissions, limits } = req.body;
    const business = await Business.findById(req.params.id);
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });

    if (planId && planId !== (business.planId?.toString() || '')) {
      const newPlan = await Plan.findById(planId);
      if (newPlan) {
        business.planId = newPlan._id;
        business.limits = newPlan.limits;
        // Si cambiamos de plan, reseteamos permisos modulares a los del plan por defecto
        business.modulePermissions = newPlan.modulePermissions || [];
      }
    }
    if (status) business.status = status;
    if (demoExpirationDate !== undefined) business.demoExpirationDate = demoExpirationDate;
    if (licenseExpiresAt !== undefined) business.licenseExpiresAt = licenseExpiresAt;
    if (modulePermissions) business.modulePermissions = modulePermissions;
    if (limits) business.limits = { ...business.limits, ...limits };

    await business.save();
    res.json(business);
  } catch (error) { res.status(500).json({ error: error.message }); }
};

// 5. DETALLE (Radiografía)
exports.getBusinessDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const business = await Business.findById(id).populate('planId');
    if (!business) return res.status(404).json({ error: "No encontrado" });

    const users = await User.find({ businessId: id }).select('-password');

    // Métricas básicas
    const clientCount = await Client.countDocuments({ businessId: id });
    const loanCount = await Loan.countDocuments({ businessId: id });

    // Storage fake calculation
    const storageMB = ((clientCount * 2 + loanCount * 4) / 1024).toFixed(2);

    res.json({
      business, users,
      metrics: { clients: clientCount, loans: loanCount, storage: storageMB }
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
};