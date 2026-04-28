const { License, Device, AccessNode, Payment, DeviceMigration, Sequelize } = require('../models');
const { Op } = require('sequelize');
const { generateLicenseKey, generateUnlockCode } = require('../utils/codeGenerator');
const { generateEncryptionKey, generateCertificate } = require('../utils/encryption');
const { sendUnlockCode, sendLicenseInfo } = require('../utils/mailer');
const { getClientIp, getGeoData } = require('../middleware/ipTracker');

exports.dashboardStats = async () => {
  const totalLicenses = await License.count();
  const activeLicenses = await License.count({ where: { status: 'active' } });
  const proLicenses = await License.count({ where: { license_type: 'pro', status: 'active' } });
  const freeLicenses = await License.count({ where: { license_type: 'free', status: 'active' } });
  const expiredLicenses = await License.count({ where: { status: 'expired' } });
  const totalDevices = await Device.count({ where: { is_active: true } });
  const totalPayments = await Payment.sum('amount', { where: { status: 'completed' } }) || 0;
  const totalVerifications = await AccessNode.count({ where: { action: 'verification' } });
  const recentAccess = await AccessNode.findAll({
    limit: 10, order: [['accessed_at', 'DESC']],
    include: [{ model: License, as: 'license', attributes: ['name', 'license_key'] }]
  });
  const monthlyRevenue = await Payment.sum('amount', {
    where: { status: 'completed', paid_at: { [Op.gte]: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } }
  }) || 0;
  const thirtyDays = new Date(); thirtyDays.setDate(thirtyDays.getDate() + 30);
  const expiringSoon = await License.count({ where: { status: 'active', end_date: { [Op.between]: [new Date(), thirtyDays] } } });
  const byRole = await License.findAll({ attributes: ['user_role', [Sequelize.fn('COUNT', 'id'), 'count']], group: ['user_role'], raw: true });
  const byCountry = await License.findAll({ attributes: ['country', [Sequelize.fn('COUNT', 'id'), 'count']], where: { country: { [Op.not]: null } }, group: ['country'], order: [[Sequelize.fn('COUNT', 'id'), 'DESC']], limit: 10, raw: true });

  return { totalLicenses, activeLicenses, proLicenses, freeLicenses, expiredLicenses, totalDevices, totalPayments, totalVerifications, recentAccess: recentAccess.map(a => a.toJSON()), monthlyRevenue, expiringSoon, byRole, byCountry };
};

exports.index = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const filterType = req.query.type || '';
    const filterStatus = req.query.status || '';
    let where = {};
    if (search) { where[Op.or] = [{ name: { [Op.like]: `%${search}%` } }, { email: { [Op.like]: `%${search}%` } }, { license_key: { [Op.like]: `%${search}%` } }]; }
    if (filterType) where.license_type = filterType;
    if (filterStatus) where.status = filterStatus;
    const { count, rows } = await License.findAndCountAll({ where, include: [{ model: Device, as: 'devices', where: { is_active: true }, required: false }], order: [['created_at', 'DESC']], limit, offset });
    const totalPages = Math.ceil(count / limit);
    res.render('licenses/index', { layout: 'main', title: 'Licencias', licenses: rows.map(l => l.toJSON()), pagination: { page, totalPages, total: count, hasPrev: page > 1, hasNext: page < totalPages, pages: Array.from({ length: totalPages }, (_, i) => ({ number: i + 1, active: i + 1 === page })) }, search, filterType, filterStatus });
  } catch (error) { console.error('License index error:', error); req.flash('error_msg', 'Error al cargar licencias.'); res.redirect('/dashboard'); }
};

exports.createPage = (req, res) => { res.render('licenses/create', { layout: 'main', title: 'Nueva Licencia' }); };

exports.create = async (req, res) => {
  try {
    const { name, email, phone, country, user_role, license_type, plan_type, device_id, device_name, device_os, device_cpu, device_ram, notes } = req.body;
    const ip = getClientIp(req); const geo = getGeoData(ip);
    const encKey = generateEncryptionKey();
    const certData = generateCertificate(name, email);
    const startDate = new Date(); let endDate = new Date();
    if (plan_type === 'annual' || license_type === 'pro') { endDate.setFullYear(endDate.getFullYear() + 1); }
    else if (plan_type === 'monthly') { endDate.setMonth(endDate.getMonth() + 1); }
    else { endDate.setFullYear(endDate.getFullYear() + 100); }

    const license = await License.create({
      license_key: generateLicenseKey(license_type), license_type: license_type || 'free', plan_type: plan_type || 'free',
      status: license_type === 'free' ? 'active' : 'pending', start_date: startDate, end_date: endDate,
      name: name.trim(), email: email.trim().toLowerCase(), phone, country: country || geo.country, country_code: geo.country,
      user_role: user_role || 'programador', encryption_key: encKey, encryption_certificate: certData.certificate,
      app_version: '1.0.0', auto_renew: false, registration_ip: ip, registration_country: geo.country, registration_city: geo.city, notes
    });

    if (device_id) {
      await Device.create({ license_id: license.id, device_id, device_name: device_name || 'Unknown', device_os: device_os || 'Unknown', device_cpu: device_cpu || '', device_ram: device_ram || '', is_active: true, last_seen: new Date(), registered_ip: ip });
    }
    await AccessNode.create({ license_id: license.id, ip_address: ip, country: geo.country, region: geo.region, city: geo.city, timezone: geo.timezone, latitude: geo.latitude, longitude: geo.longitude, action: 'registration', user_agent: req.headers['user-agent'], response_status: true, accessed_at: new Date() });
    await sendLicenseInfo(email, license.toJSON());

    if (req.headers['content-type'] === 'application/json' || req.originalUrl.startsWith('/api')) {
      return res.status(201).json({ success: true, license: license.toJSON() });
    }
    req.flash('success_msg', 'Licencia creada exitosamente.');
    return res.redirect(`/dashboard/licenses/${license.id}`);
  } catch (error) {
    console.error('Create license error:', error);
    if (req.headers['content-type'] === 'application/json') return res.status(500).json({ success: false, error: error.message });
    req.flash('error_msg', 'Error al crear licencia: ' + error.message);
    return res.redirect('/dashboard/licenses/create');
  }
};

exports.view = async (req, res) => {
  try {
    const license = await License.findByPk(req.params.id, {
      include: [{ model: Device, as: 'devices' }, { model: AccessNode, as: 'access_nodes', limit: 50, order: [['accessed_at', 'DESC']] }, { model: Payment, as: 'payments', order: [['created_at', 'DESC']] }, { model: DeviceMigration, as: 'migrations', order: [['migrated_at', 'DESC']] }]
    });
    if (!license) { req.flash('error_msg', 'Licencia no encontrada.'); return res.redirect('/dashboard/licenses'); }
    const daysRemaining = license.end_date ? Math.max(0, Math.ceil((new Date(license.end_date) - new Date()) / (1000 * 60 * 60 * 24))) : 0;
    res.render('licenses/view', { layout: 'main', title: `Licencia: ${license.license_key}`, license: license.toJSON(), daysRemaining, isExpired: license.status === 'expired' || daysRemaining === 0 });
  } catch (error) { console.error('View license error:', error); req.flash('error_msg', 'Error al cargar licencia.'); return res.redirect('/dashboard/licenses'); }
};

exports.editPage = async (req, res) => {
  try {
    const license = await License.findByPk(req.params.id);
    if (!license) { req.flash('error_msg', 'Licencia no encontrada.'); return res.redirect('/dashboard/licenses'); }
    res.render('licenses/edit', { layout: 'main', title: 'Editar Licencia', license: license.toJSON() });
  } catch (error) { req.flash('error_msg', 'Error al cargar licencia.'); return res.redirect('/dashboard/licenses'); }
};

exports.update = async (req, res) => {
  try {
    const license = await License.findByPk(req.params.id);
    if (!license) { req.flash('error_msg', 'Licencia no encontrada.'); return res.redirect('/dashboard/licenses'); }
    const { name, email, phone, country, user_role, license_type, plan_type, status, auto_renew, app_version, notes } = req.body;
    await license.update({ name, email, phone, country, user_role, license_type, plan_type, status, auto_renew: auto_renew === 'on' || auto_renew === true, app_version, notes });
    if (req.headers['content-type'] === 'application/json') return res.json({ success: true, license: license.toJSON() });
    req.flash('success_msg', 'Licencia actualizada.');
    return res.redirect(`/dashboard/licenses/${license.id}`);
  } catch (error) { req.flash('error_msg', 'Error al actualizar: ' + error.message); return res.redirect(`/dashboard/licenses/${req.params.id}/edit`); }
};

exports.delete = async (req, res) => {
  try {
    const license = await License.findByPk(req.params.id);
    if (!license) { req.flash('error_msg', 'Licencia no encontrada.'); return res.redirect('/dashboard/licenses'); }
    await AccessNode.destroy({ where: { license_id: license.id } });
    await Device.destroy({ where: { license_id: license.id } });
    await Payment.destroy({ where: { license_id: license.id } });
    await DeviceMigration.destroy({ where: { license_id: license.id } });
    await license.destroy();
    req.flash('success_msg', 'Licencia eliminada.');
    return res.redirect('/dashboard/licenses');
  } catch (error) { req.flash('error_msg', 'Error al eliminar licencia.'); return res.redirect('/dashboard/licenses'); }
};

exports.upgrade = async (req, res) => {
  try {
    const license = await License.findByPk(req.params.id);
    if (!license) {
      if (req.headers['content-type'] === 'application/json') return res.status(404).json({ success: false, error: 'No encontrada.' });
      req.flash('error_msg', 'No encontrada.'); return res.redirect('/dashboard/licenses');
    }
    const { plan_type } = req.body;
    const startDate = new Date(); let endDate = new Date();
    if (plan_type === 'annual') endDate.setFullYear(endDate.getFullYear() + 1); else endDate.setMonth(endDate.getMonth() + 1);
    const newKey = generateLicenseKey('pro'); const encKey = generateEncryptionKey(); const certData = generateCertificate(license.name, license.email);
    await license.update({ license_key: newKey, license_type: 'pro', plan_type: plan_type || 'annual', status: 'active', start_date: startDate, end_date: endDate, encryption_key: encKey, encryption_certificate: certData.certificate });
    const ip = getClientIp(req); const geo = getGeoData(ip);
    await AccessNode.create({ license_id: license.id, ip_address: ip, country: geo.country, region: geo.region, city: geo.city, action: 'upgrade', user_agent: req.headers['user-agent'], response_status: true, accessed_at: new Date() });
    await sendLicenseInfo(license.email, { ...license.toJSON(), license_key: newKey });
    if (req.headers['content-type'] === 'application/json') return res.json({ success: true, license: license.toJSON() });
    req.flash('success_msg', `Licencia actualizada a PRO (${plan_type}).`);
    return res.redirect(`/dashboard/licenses/${license.id}`);
  } catch (error) { console.error('Upgrade error:', error); req.flash('error_msg', 'Error al actualizar.'); return res.redirect('/dashboard/licenses'); }
};

exports.generateUnlock = async (req, res) => {
  try {
    const { license_id, send_email } = req.body;
    const license = await License.findByPk(license_id || req.params.id);
    if (!license) {
      if (req.originalUrl.startsWith('/api')) return res.status(404).json({ success: false, error: 'No encontrada.' });
      req.flash('error_msg', 'No encontrada.'); return res.redirect('/dashboard/licenses');
    }
    const code = generateUnlockCode();
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    await license.update({ unlock_code: code, unlock_code_expires: expires });
    const ip = getClientIp(req); const geo = getGeoData(ip);
    await AccessNode.create({ license_id: license.id, ip_address: ip, country: geo.country, region: geo.region, city: geo.city, action: 'unlock', user_agent: req.headers['user-agent'], response_status: true, accessed_at: new Date() });
    if (send_email !== false && send_email !== 'false') { await sendUnlockCode(license.email, code, license.name); }
    if (req.originalUrl.startsWith('/api')) return res.json({ success: true, unlock_code: code, expires, email_sent: send_email !== false });
    req.flash('success_msg', `Código generado: ${code} (enviado a ${license.email})`);
    return res.redirect(`/dashboard/licenses/${license.id}`);
  } catch (error) {
    if (req.originalUrl.startsWith('/api')) return res.status(500).json({ success: false, error: error.message });
    req.flash('error_msg', 'Error al generar código.'); return res.redirect('/dashboard/licenses');
  }
};

exports.renew = async (req, res) => {
  try {
    const license = await License.findByPk(req.params.id);
    if (!license) { req.flash('error_msg', 'No encontrada.'); return res.redirect('/dashboard/licenses'); }
    const startDate = new Date(); let endDate = new Date();
    if (license.plan_type === 'annual') endDate.setFullYear(endDate.getFullYear() + 1);
    else if (license.plan_type === 'monthly') endDate.setMonth(endDate.getMonth() + 1);
    else endDate.setFullYear(endDate.getFullYear() + 1);
    await license.update({ status: 'active', start_date: startDate, end_date: endDate });
    const ip = getClientIp(req); const geo = getGeoData(ip);
    await AccessNode.create({ license_id: license.id, ip_address: ip, country: geo.country, region: geo.region, city: geo.city, action: 'renewal', user_agent: req.headers['user-agent'], response_status: true, accessed_at: new Date() });
    req.flash('success_msg', 'Licencia renovada.');
    return res.redirect(`/dashboard/licenses/${license.id}`);
  } catch (error) { req.flash('error_msg', 'Error al renovar.'); return res.redirect('/dashboard/licenses'); }
};
