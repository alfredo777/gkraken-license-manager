// Cambia el dispositivo activo de una licencia. Lo usan el dashboard, la API
// con JWT y el login con Google (mode=migrate).
const { Device, DeviceMigration, AccessNode } = require('../models');
const { sendMigrationNotification } = require('./mailer');
const { deviceFieldsFrom } = require('./licenseService');
const { revokeDeviceTokens } = require('./aiTokens');

// `license` debe traer sus devices activos en `license.devices`.
// `newDevice` usa los nombres de campo de la app (device_id, device_name, ...).
const migrateDevice = async (license, newDevice, { reason, migratedBy, ip, geo, userAgent }) => {
  // Se desactivan los dispositivos menos recientes hasta dejar un lugar libre.
  const active = (license.devices || [])
    .filter(d => d.is_active && d.device_id !== newDevice.device_id)
    .sort((a, b) => new Date(a.last_seen || 0) - new Date(b.last_seen || 0));
  const toRemove = active.slice(0, Math.max(1, active.length - (license.max_devices || 1) + 1));
  const previous = toRemove[0];
  for (const d of toRemove) { await d.update({ is_active: false }); await revokeDeviceTokens(license.id, d.device_id); }

  const fields = deviceFieldsFrom(newDevice);
  const existing = await Device.findOne({ where: { license_id: license.id, device_id: fields.device_id } });
  if (existing) await existing.update({ ...fields, is_active: true, last_seen: new Date() });
  else await Device.create({ license_id: license.id, ...fields, is_active: true, last_seen: new Date(), registered_ip: ip });

  await DeviceMigration.create({
    license_id: license.id, old_device_id: previous?.device_id || 'N/A', old_device_name: previous?.device_name || 'N/A',
    new_device_id: fields.device_id, new_device_name: fields.device_name, reason: reason || 'Migración',
    migrated_by: migratedBy, ip_address: ip, migrated_at: new Date()
  });
  await AccessNode.create({
    license_id: license.id, ip_address: ip, country: geo?.country, region: geo?.region, city: geo?.city,
    action: 'migration', user_agent: userAgent, device_id: fields.device_id, response_status: true, accessed_at: new Date()
  });
  await sendMigrationNotification(license.email, license.name, previous?.device_name || 'N/A', fields.device_name);
  return { previousDeviceId: previous?.device_id || null };
};

module.exports = { migrateDevice };
