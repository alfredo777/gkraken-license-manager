const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Admin } = require('../models');

const requireAuth = (req, res, next) => {
  if (req.session && req.session.admin) {
    return next();
  }
  req.flash('error_msg', 'Debes iniciar sesión para acceder.');
  return res.redirect('/admin/login');
};

const requireSuperAdmin = (req, res, next) => {
  if (req.session && req.session.admin && req.session.admin.role === 'superadmin') {
    return next();
  }
  req.flash('error_msg', 'No tienes permisos para esta acción.');
  return res.redirect('/dashboard');
};

const requireApiAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Token de acceso requerido.' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const admin = await Admin.findByPk(decoded.id);
    if (!admin || !admin.is_active) {
      return res.status(401).json({ success: false, error: 'Token inválido o cuenta desactivada.' });
    }
    req.admin = admin;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Token expirado.' });
    }
    return res.status(401).json({ success: false, error: 'Token inválido.' });
  }
};

// Clave de la app cliente (cabecera X-API-Key). Falla cerrado: sin API_KEY
// configurada solo se permite en desarrollo/pruebas; en producción responde 503.
const requireApiKey = (req, res, next) => {
  const expected = process.env.API_KEY;
  if (!expected) {
    if (process.env.NODE_ENV === 'production') return res.status(503).json({ success: false, error: 'API_KEY no configurada en el servidor.' });
    return next();
  }
  const given = req.get('x-api-key') || '';
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  if (!given || !crypto.timingSafeEqual(a, b)) return res.status(403).json({ success: false, error: 'API key inválida.' });
  next();
};

module.exports = { requireAuth, requireSuperAdmin, requireApiAuth, requireApiKey };
