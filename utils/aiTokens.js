// Tokens de IA por dispositivo: se emiten al terminar el login con Google en la
// app y se revocan al liberar o migrar el equipo.
const crypto = require('crypto');
const { Op } = require('sequelize');
const { AiToken } = require('../models');

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

// Emite un token nuevo para (licencia, dispositivo) y revoca los anteriores de ese equipo.
const issueToken = async (licenseId, deviceId, deviceName) => {
  await revokeDeviceTokens(licenseId, deviceId);
  const token = `gkai_${crypto.randomBytes(32).toString('base64url')}`;
  await AiToken.create({ license_id: licenseId, device_id: deviceId || null, device_name: deviceName || null, token_hash: hashToken(token), prefix: token.slice(0, 12) });
  return token;
};

const revokeDeviceTokens = (licenseId, deviceId) => AiToken.update(
  { revoked_at: new Date() },
  { where: { license_id: licenseId, device_id: deviceId || null, revoked_at: null } }
);

const revokeTokensExcept = (licenseId, keepDeviceIds) => AiToken.update(
  { revoked_at: new Date() },
  { where: { license_id: licenseId, revoked_at: null, device_id: { [Op.notIn]: keepDeviceIds.length ? keepDeviceIds : [''] } } }
);

module.exports = { hashToken, issueToken, revokeDeviceTokens, revokeTokensExcept };
