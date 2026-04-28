const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Admin } = require('../models');
const { Op } = require('sequelize');
const { generateActivationCode } = require('../utils/codeGenerator');
const { sendActivationCode } = require('../utils/mailer');
const { getClientIp } = require('../middleware/ipTracker');

exports.loginPage = (req, res) => {
  if (req.session.admin) return res.redirect('/dashboard');
  res.render('login', { layout: 'main', title: 'Iniciar Sesión' });
};

exports.login = async (req, res) => {
  try {
    const { username, password, access_code } = req.body;
    const admin = await Admin.findOne({ where: { username: username.trim().toLowerCase() } });

    if (!admin) { req.flash('error_msg', 'Credenciales incorrectas.'); return res.redirect('/admin/login'); }
    if (!admin.is_active) { req.flash('error_msg', 'Cuenta desactivada.'); return res.redirect('/admin/login'); }

    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) { req.flash('error_msg', 'Credenciales incorrectas.'); return res.redirect('/admin/login'); }

    if (admin.access_code && access_code !== admin.access_code) {
      req.flash('error_msg', 'Código de acceso incorrecto.'); return res.redirect('/admin/login');
    }

    await admin.update({ last_login: new Date(), last_login_ip: getClientIp(req) });

    req.session.admin = { id: admin.id, username: admin.username, email: admin.email, role: admin.role };
    req.flash('success_msg', `Bienvenido, ${admin.username}!`);
    return res.redirect('/dashboard');
  } catch (error) {
    console.error('Login error:', error);
    req.flash('error_msg', 'Error al iniciar sesión.');
    return res.redirect('/admin/login');
  }
};

exports.logout = (req, res) => { req.session.destroy(() => res.redirect('/admin/login')); };

exports.register = async (req, res) => {
  try {
    const { username, email, phone, password, password_confirm, role } = req.body;
    if (password !== password_confirm) { req.flash('error_msg', 'Las contraseñas no coinciden.'); return res.redirect('/admin/settings'); }

    const exists = await Admin.findOne({ where: { [Op.or]: [{ username }, { email }] } });
    if (exists) { req.flash('error_msg', 'El usuario o email ya existe.'); return res.redirect('/admin/settings'); }

    const hash = await bcrypt.hash(password, 12);
    const activationCode = generateActivationCode();

    await Admin.create({
      username: username.trim().toLowerCase(), email: email.trim().toLowerCase(),
      phone, password_hash: hash, role: role || 'admin', activation_code: activationCode,
      activation_code_expires: new Date(Date.now() + 24 * 60 * 60 * 1000), is_active: false
    });

    await sendActivationCode(email, activationCode, username);
    req.flash('success_msg', `Admin creado. Código enviado a ${email}.`);
    return res.redirect('/admin/settings');
  } catch (error) {
    console.error('Register error:', error);
    req.flash('error_msg', 'Error al registrar admin.');
    return res.redirect('/admin/settings');
  }
};

exports.activate = async (req, res) => {
  try {
    const { email, activation_code } = req.body;
    const admin = await Admin.findOne({ where: { email: email.trim().toLowerCase() } });

    if (!admin) { req.flash('error_msg', 'Email no encontrado.'); return res.redirect('/admin/login'); }
    if (admin.is_active) { req.flash('error_msg', 'Cuenta ya activa.'); return res.redirect('/admin/login'); }
    if (admin.activation_code !== activation_code) { req.flash('error_msg', 'Código incorrecto.'); return res.redirect('/admin/login'); }
    if (admin.activation_code_expires && new Date() > admin.activation_code_expires) { req.flash('error_msg', 'Código expirado.'); return res.redirect('/admin/login'); }

    await admin.update({ is_active: true, activation_code: null, activation_code_expires: null });
    req.flash('success_msg', 'Cuenta activada. Ya puedes iniciar sesión.');
    return res.redirect('/admin/login');
  } catch (error) {
    req.flash('error_msg', 'Error al activar cuenta.');
    return res.redirect('/admin/login');
  }
};

exports.resendActivation = async (req, res) => {
  try {
    const { email } = req.body;
    const admin = await Admin.findOne({ where: { email } });
    if (!admin || admin.is_active) { req.flash('error_msg', 'Email no encontrado o ya activo.'); return res.redirect('/admin/login'); }

    const newCode = generateActivationCode();
    await admin.update({ activation_code: newCode, activation_code_expires: new Date(Date.now() + 24 * 60 * 60 * 1000) });
    await sendActivationCode(email, newCode, admin.username);
    req.flash('success_msg', 'Nuevo código enviado.');
    return res.redirect('/admin/login');
  } catch (error) {
    req.flash('error_msg', 'Error al reenviar código.');
    return res.redirect('/admin/login');
  }
};

exports.apiLogin = async (req, res) => {
  try {
    const { username, password, access_code } = req.body;
    const admin = await Admin.findOne({ where: { username } });
    if (!admin || !admin.is_active) return res.status(401).json({ success: false, error: 'Credenciales inválidas.' });

    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) return res.status(401).json({ success: false, error: 'Credenciales inválidas.' });
    if (admin.access_code && access_code !== admin.access_code) return res.status(401).json({ success: false, error: 'Código de acceso incorrecto.' });

    const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role }, process.env.JWT_SECRET, { expiresIn: '24h' });
    await admin.update({ last_login: new Date(), last_login_ip: getClientIp(req) });

    return res.json({ success: true, token, admin: { id: admin.id, username: admin.username, email: admin.email, role: admin.role } });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Error del servidor.' });
  }
};

exports.profilePage = async (req, res) => {
  const admin = await Admin.findByPk(req.session.admin.id);
  res.render('admin/profile', { layout: 'main', title: 'Mi Perfil', adminData: admin.toJSON() });
};

exports.updateProfile = async (req, res) => {
  try {
    const { email, phone, current_password, new_password, access_code } = req.body;
    const admin = await Admin.findByPk(req.session.admin.id);
    const updateData = { email, phone };
    if (access_code) updateData.access_code = access_code;
    if (new_password) {
      const isMatch = await bcrypt.compare(current_password, admin.password_hash);
      if (!isMatch) { req.flash('error_msg', 'Contraseña actual incorrecta.'); return res.redirect('/admin/profile'); }
      updateData.password_hash = await bcrypt.hash(new_password, 12);
    }
    await admin.update(updateData);
    req.session.admin.email = email;
    req.flash('success_msg', 'Perfil actualizado.');
    return res.redirect('/admin/profile');
  } catch (error) {
    req.flash('error_msg', 'Error al actualizar perfil.');
    return res.redirect('/admin/profile');
  }
};

exports.settingsPage = async (req, res) => {
  const admins = await Admin.findAll({ order: [['created_at', 'DESC']] });
  res.render('admin/settings', { layout: 'main', title: 'Configuración', admins: admins.map(a => a.toJSON()) });
};
