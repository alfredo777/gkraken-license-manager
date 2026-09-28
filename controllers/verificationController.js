const { License, AccessNode } = require('../models');
const { getClientIp, getGeoData } = require('../middleware/ipTracker');

// POST /verify vive en clientApiController (formato que espera Green Kraken).

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
    const license = await License.findOne({ where: { license_key }, attributes: ['license_key', 'license_type', 'plan_type', 'status', 'start_date', 'end_date', 'user_role', 'app_version', 'last_app_update'] });
    if (!license) return res.status(404).json({ success: false, error: 'No encontrada.' });
    return res.json({ success: true, license: license.toJSON() });
  } catch (error) { return res.status(500).json({ success: false, error: 'Error del servidor.' }); }
};
