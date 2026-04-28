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

const requireApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey || apiKey !== process.env.API_KEY) {
    if (!process.env.API_KEY) return next();
    return res.status(403).json({ success: false, error: 'API key inválida.' });
  }
  next();
};

module.exports = { requireAuth, requireSuperAdmin, requireApiAuth, requireApiKey };
