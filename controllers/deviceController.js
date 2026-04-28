const { License, Device, AccessNode, DeviceMigration } = require('../models');
const { getClientIp, getGeoData } = require('../middleware/ipTracker');
const { sendMigrationNotification } = require('../utils/mailer');

exports.index = async (req, res) => {
  try {
    const devices = await Device.findAll({ include: [{ model: License, as: 'license', attributes: ['license_key', 'name', 'email', 'status'] }], order: [['created_at', 'DESC']] });
    res.render('devices/index', { layout: 'main', title: 'Dispositivos', devices: devices.map(d => d.toJSON()) });
  } catch (error) { req.flash('error_msg', 'Error al cargar dispositivos.'); res.redirect('/dashboard'); }
};

exports.migratePage = async (req, res) => {
  try {
    const license = await License.findByPk(req.params.licenseId, { include: [{ model: Device, as: 'devices' }] });
    if (!license) { req.flash('error_msg', 'Licencia no encontrada.'); return res.redirect('/dashboard/licenses'); }
    const migrations = await DeviceMigration.findAll({ where: { license_id: license.id }, order: [['migrated_at', 'DESC']] });
    res.render('devices/migrate', { layout: 'main', title: 'Migrar Dispositivo', license: license.toJSON(), migrations: migrations.map(m => m.toJSON()) });
  } catch (error) { req.flash('error_msg', 'Error al cargar migración.'); res.redirect('/dashboard/licenses'); }
};

exports.migrate = async (req, res) => {
  try {
    const { license_id, new_device_id, new_device_name, new_device_os, new_device_cpu, new_device_ram, reason } = req.body;
    const licenseId = license_id || req.params.licenseId;
    const ip = getClientIp(req); const geo = getGeoData(ip);
    const license = await License.findByPk(licenseId, { include: [{ model: Device, as: 'devices', where: { is_active: true }, required: false }] });
    if (!license) {
      if (req.originalUrl.startsWith('/api')) return res.status(404).json({ success: false, error: 'No encontrada.' });
      req.flash('error_msg', 'No encontrada.'); return res.redirect('/dashboard/licenses');
    }
    const activeDevice = license.devices?.[0];
    const oldDeviceId = activeDevice?.device_id || 'N/A';
    const oldDeviceName = activeDevice?.device_name || 'N/A';
    if (activeDevice) await activeDevice.update({ is_active: false });
    await Device.create({ license_id: license.id, device_id: new_device_id, device_name: new_device_name || 'Unknown', device_os: new_device_os || '', device_cpu: new_device_cpu || '', device_ram: new_device_ram || '', is_active: true, last_seen: new Date(), registered_ip: ip });
    await DeviceMigration.create({ license_id: license.id, old_device_id: oldDeviceId, old_device_name: oldDeviceName, new_device_id, new_device_name: new_device_name || 'Unknown', reason: reason || 'Migración', migrated_by: req.originalUrl.startsWith('/api') ? 'api' : 'admin', ip_address: ip, migrated_at: new Date() });
    await AccessNode.create({ license_id: license.id, ip_address: ip, country: geo.country, region: geo.region, city: geo.city, action: 'migration', user_agent: req.headers['user-agent'], device_id: new_device_id, response_status: true, accessed_at: new Date() });
    await sendMigrationNotification(license.email, license.name, oldDeviceName, new_device_name || new_device_id);
    if (req.originalUrl.startsWith('/api')) return res.json({ success: true, message: 'Dispositivo migrado.' });
    req.flash('success_msg', 'Dispositivo migrado.');
    return res.redirect(`/dashboard/licenses/${license.id}`);
  } catch (error) {
    console.error('Migration error:', error);
    if (req.originalUrl.startsWith('/api')) return res.status(500).json({ success: false, error: error.message });
    req.flash('error_msg', 'Error: ' + error.message); return res.redirect('/dashboard/licenses');
  }
};

exports.deactivate = async (req, res) => {
  try {
    const device = await Device.findByPk(req.params.id);
    if (!device) { req.flash('error_msg', 'No encontrado.'); return res.redirect('/dashboard/devices'); }
    await device.update({ is_active: false });
    req.flash('success_msg', 'Dispositivo desactivado.');
    return res.redirect('/dashboard/devices');
  } catch (error) { req.flash('error_msg', 'Error.'); return res.redirect('/dashboard/devices'); }
};
