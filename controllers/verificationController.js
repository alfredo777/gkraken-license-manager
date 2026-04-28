const { License, Device, AccessNode } = require('../models');
const { getClientIp, getGeoData } = require('../middleware/ipTracker');

exports.verifyLicense = async (req, res) => {
  try {
    const { license_key, device_id, app_version } = req.body;
    const ip = getClientIp(req); const geo = getGeoData(ip);
    if (!license_key || !device_id) return res.status(400).json({ valid: false, error: 'license_key y device_id son requeridos.' });

    const license = await License.findOne({ where: { license_key }, include: [{ model: Device, as: 'devices', where: { device_id, is_active: true }, required: false }] });
    let isValid = false; let reason = '';

    if (!license) { reason = 'Licencia no encontrada.'; }
    else if (license.status !== 'active') { reason = `Licencia ${license.status}.`; }
    else if (license.end_date && new Date(license.end_date) < new Date()) { reason = 'Licencia expirada.'; await license.update({ status: 'expired' }); }
    else if (!license.devices || license.devices.length === 0) { reason = 'Dispositivo no vinculado.'; }
    else { isValid = true; }

    if (license) {
      const updateData = { last_verification_ip: ip, last_verification_at: new Date(), total_verifications: (license.total_verifications || 0) + 1 };
      if (app_version) { updateData.app_version = app_version; if (app_version !== license.app_version) updateData.last_app_update = new Date(); }
      await license.update(updateData);
      if (license.devices && license.devices.length > 0) await license.devices[0].update({ last_seen: new Date() });
      await AccessNode.create({ license_id: license.id, ip_address: ip, country: geo.country, region: geo.region, city: geo.city, timezone: geo.timezone, latitude: geo.latitude, longitude: geo.longitude, action: 'verification', user_agent: req.headers['user-agent'], device_id, app_version: app_version || license.app_version, response_status: isValid, accessed_at: new Date() });
    }

    return res.json({
      valid: isValid, license_type: license?.license_type || null, plan_type: license?.plan_type || null, status: license?.status || null,
      end_date: license?.end_date || null, days_remaining: license?.end_date ? Math.max(0, Math.ceil((new Date(license.end_date) - new Date()) / (1000 * 60 * 60 * 24))) : 0,
      app_version: license?.app_version || null, reason: isValid ? 'Licencia y dispositivo válidos.' : reason, timestamp: new Date().toISOString()
    });
  } catch (error) { console.error('Verification error:', error); return res.status(500).json({ valid: false, error: 'Error del servidor.' }); }
};

exports.verifyUnlockCode = async (req, res) => {
  try {
    const { license_key, unlock_code, device_id } = req.body;
    const ip = getClientIp(req); const geo = getGeoData(ip);
    const license = await License.findOne({ where: { license_key } });
    if (!license) return res.json({ valid: false, error: 'Licencia no encontrada.' });
    if (!license.unlock_code || license.unlock_code !== unlock_code) return res.json({ valid: false, error: 'Código incorrecto.' });
    if (license.unlock_code_expires && new Date() > new Date(license.unlock_code_expires)) { await license.update({ unlock_code: null, unlock_code_expires: null }); return res.json({ valid: false, error: 'Código expirado.' }); }
    await license.update({ unlock_code: null, unlock_code_expires: null });
    await AccessNode.create({ license_id: license.id, ip_address: ip, country: geo.country, region: geo.region, city: geo.city, action: 'unlock', user_agent: req.headers['user-agent'], device_id: device_id || null, response_status: true, accessed_at: new Date() });
    return res.json({ valid: true, message: 'Desbloqueo exitoso.' });
  } catch (error) { return res.status(500).json({ valid: false, error: 'Error del servidor.' }); }
};

exports.requestUnlockCode = async (req, res) => {
  try {
    const { license_key } = req.body;
    const license = await License.findOne({ where: { license_key } });
    if (!license) return res.status(404).json({ success: false, error: 'Licencia no encontrada.' });
    const { generateUnlockCode } = require('../utils/codeGenerator');
    const { sendUnlockCode } = require('../utils/mailer');
    const code = generateUnlockCode();
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    await license.update({ unlock_code: code, unlock_code_expires: expires });
    await sendUnlockCode(license.email, code, license.name);
    return res.json({ success: true, message: `Código enviado a ${license.email.replace(/(.{2})(.*)(@.*)/, '$1***$3')}`, expires });
  } catch (error) { return res.status(500).json({ success: false, error: 'Error del servidor.' }); }
};

exports.getLicenseInfo = async (req, res) => {
  try {
    const { license_key } = req.params;
    const license = await License.findOne({ where: { license_key }, attributes: ['license_key', 'license_type', 'plan_type', 'status', 'start_date', 'end_date', 'name', 'user_role', 'app_version', 'last_app_update'] });
    if (!license) return res.status(404).json({ success: false, error: 'No encontrada.' });
    return res.json({ success: true, license: license.toJSON() });
  } catch (error) { return res.status(500).json({ success: false, error: 'Error del servidor.' }); }
};
