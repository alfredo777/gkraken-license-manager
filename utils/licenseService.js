// Lógica de licencias compartida entre la API cliente (Green Kraken), el login
// con Google y el dashboard: alta de licencias FREE, vinculación de dispositivos
// y las respuestas JSON en el formato que espera la app.
const { License, Device, AccessNode } = require('../models');
const { generateLicenseKey } = require('./codeGenerator');
const { generateEncryptionKey, generateCertificate } = require('./encryption');
const { sendLicenseInfo } = require('./mailer');
const { FEATURES, PRICES, CURRENCY, featuresFor } = require('../config/features');

const DAY = 24 * 60 * 60 * 1000;
const USER_ROLES = ['estudiante', 'docente', 'programador', 'emprendedor', 'investigador', 'empresa', 'otro'];

const clip = (value, max) => (value === undefined || value === null || value === '') ? null : String(value).slice(0, max);

// Campos de dispositivo que manda la app → columnas del modelo Device.
const deviceFieldsFrom = (body = {}) => ({
  device_id: clip(body.device_id, 500),
  device_name: clip(body.device_name || [body.device_brand, body.device_model].filter(Boolean).join(' '), 255) || 'Unknown',
  device_os: clip(body.device_os, 100),
  device_os_version: clip(body.device_os_version, 50),
  device_cpu: clip(body.device_cpu, 255),
  device_ram: clip(body.device_ram, 50),
  device_mac: clip(body.device_mac, 50),
  device_motherboard: clip(body.device_board, 255),
  device_disk_serial: clip(body.device_disk_id, 255)
});

// Estados del servidor → estados que conoce la app (active|expired|suspended|revoked).
const clientStatus = (license) => {
  if (license.status === 'cancelled') return 'revoked';
  if (license.status === 'pending') return 'suspended';
  if (license.status === 'active' && license.end_date && new Date(license.end_date) < new Date()) return 'expired';
  return license.status;
};

const daysRemaining = (license) => license.end_date ? Math.max(0, Math.ceil((new Date(license.end_date) - Date.now()) / DAY)) : 0;
const isLifetime = (license) => license.plan_type === 'lifetime' || license.plan_type === 'free';

const buildLicenseInfo = (license) => ({
  license_key: license.license_key,
  license_type: license.license_type,
  plan_type: license.plan_type,
  status: clientStatus(license),
  start_date: license.start_date,
  end_date: license.end_date,
  features: featuresFor(license),
  max_devices: license.max_devices || 1,
  user_role: license.user_role,
  encryption_certificate: license.encryption_certificate
});

const renewalPlans = () => [
  { plan_type: 'monthly', price: PRICES.monthly, currency: CURRENCY, description: 'Green Kraken PRO mensual' },
  { plan_type: 'annual', price: PRICES.annual, currency: CURRENCY, description: 'Green Kraken PRO anual' }
];

const STATUS_MESSAGES = {
  LICENSE_VALID: 'Licencia y dispositivo válidos.',
  LICENSE_NOT_FOUND: 'Licencia no encontrada.',
  LICENSE_SUSPENDED: 'Licencia suspendida.',
  LICENSE_PENDING: 'Licencia pendiente de pago.',
  LICENSE_REVOKED: 'Licencia revocada.',
  LICENSE_EXPIRED: 'Licencia expirada.',
  DEVICE_NOT_LINKED: 'Este dispositivo no está vinculado a la licencia.'
};

// Arma la respuesta de POST /verify. `license` debe traer TODOS sus devices.
const buildVerifyResponse = (license, deviceId) => {
  const now = new Date();
  if (!license) {
    return {
      valid: false, license_key: null, license_type: null, plan_type: null, status: null, days_remaining: 0,
      features: [], key_updated: false, reason: STATUS_MESSAGES.LICENSE_NOT_FOUND,
      status_detail: { code: 'LICENSE_NOT_FOUND', message: STATUS_MESSAGES.LICENSE_NOT_FOUND },
      support_email: process.env.SUPPORT_EMAIL || null, timestamp: now.toISOString()
    };
  }

  const devices = (license.devices || []).filter(d => d.is_active);
  const current = devices.find(d => d.device_id === deviceId);
  const maxDevices = license.max_devices || 1;
  const status = clientStatus(license);

  let code = 'LICENSE_VALID';
  let message = STATUS_MESSAGES.LICENSE_VALID;
  if (status === 'revoked') { code = 'LICENSE_REVOKED'; message = STATUS_MESSAGES.LICENSE_REVOKED; }
  else if (status === 'suspended') { code = 'LICENSE_SUSPENDED'; message = license.status === 'pending' ? STATUS_MESSAGES.LICENSE_PENDING : STATUS_MESSAGES.LICENSE_SUSPENDED; }
  else if (status === 'expired') { code = 'LICENSE_EXPIRED'; message = STATUS_MESSAGES.LICENSE_EXPIRED; }
  else if (!current) { code = 'DEVICE_NOT_LINKED'; message = STATUS_MESSAGES.DEVICE_NOT_LINKED; }

  const valid = code === 'LICENSE_VALID';
  const remaining = daysRemaining(license);
  const response = {
    valid,
    ...buildLicenseInfo(license),
    status,
    days_remaining: remaining,
    app_version: license.app_version,
    update_available: false,
    reason: message,
    key_updated: false,
    current_license_key: license.license_key,
    status_detail: { code, message },
    is_pro: license.license_type === 'pro' && valid,
    is_lifetime: isLifetime(license),
    near_expiry: !isLifetime(license) && status === 'active' && remaining <= 7,
    support_email: process.env.SUPPORT_EMAIL || null,
    device_link_info: {
      active_devices: devices.length,
      max_devices: maxDevices,
      can_add_device: devices.length < maxDevices,
      needs_migration: !current && devices.length >= maxDevices,
      devices: devices.map(d => ({ device_id: d.device_id, device_name: d.device_name, last_seen: d.last_seen, is_current_device: d.device_id === deviceId }))
    },
    timestamp: now.toISOString()
  };
  if (current) response.device_info = { device_id: current.device_id, device_name: current.device_name, last_seen: current.last_seen, is_current_device: true };
  if (code === 'LICENSE_EXPIRED') {
    response.renewal_plans = renewalPlans();
    response.fallback_features = { features: FEATURES.free, message: 'Tu licencia expiró: sigues con las funciones gratuitas.' };
    response.expired_at = license.end_date;
    response.days_since_expiry = license.end_date ? Math.max(0, Math.floor((now - new Date(license.end_date)) / DAY)) : null;
    response.can_recover = true;
  }
  return response;
};

const logAccess = (license, action, ctx, extra = {}) => AccessNode.create({
  license_id: license.id, ip_address: ctx.ip, country: ctx.geo?.country, region: ctx.geo?.region, city: ctx.geo?.city,
  timezone: ctx.geo?.timezone, latitude: ctx.geo?.latitude, longitude: ctx.geo?.longitude,
  action, user_agent: ctx.userAgent, response_status: true, accessed_at: new Date(), ...extra
});

// Crea una licencia FREE activa y vincula el dispositivo. `profile` trae name,
// email y opcionalmente phone, country, user_role, google_sub, avatar_url.
const createFreeLicense = async (profile, device, ctx) => {
  const start = new Date();
  const end = new Date(start); end.setFullYear(end.getFullYear() + 100);
  const role = USER_ROLES.includes(profile.user_role) ? profile.user_role : 'otro';
  const cert = generateCertificate(profile.name, profile.email);
  const license = await License.create({
    license_key: generateLicenseKey('free'), license_type: 'free', plan_type: 'free', status: 'active',
    start_date: start, end_date: end,
    name: clip(profile.name, 255) || profile.email, email: profile.email.trim().toLowerCase(),
    phone: clip(profile.phone, 20), country: clip(profile.country, 100) || ctx.geo?.country, country_code: clip(ctx.geo?.country, 5),
    user_role: role, encryption_key: generateEncryptionKey(), encryption_certificate: cert.certificate,
    app_version: clip(device.app_version, 20) || '1.0.0', auto_renew: false,
    registration_ip: ctx.ip, registration_country: ctx.geo?.country, registration_city: ctx.geo?.city,
    google_sub: profile.google_sub || null, auth_provider: profile.google_sub ? 'google' : 'manual', avatar_url: clip(profile.avatar_url, 1024),
    max_devices: 1
  });
  await linkDevice(license, device, ctx);
  await logAccess(license, 'registration', ctx, { device_id: device.device_id, app_version: clip(device.app_version, 20) });
  await sendLicenseInfo(license.email, license.toJSON());
  return license;
};

const linkDevice = (license, device, ctx) => Device.create({
  license_id: license.id, ...deviceFieldsFrom(device), is_active: true, last_seen: new Date(), registered_ip: ctx.ip
});

const loadWithDevices = (where) => License.findOne({ where, include: [{ model: Device, as: 'devices', required: false }] });

module.exports = {
  USER_ROLES, deviceFieldsFrom, clientStatus, buildLicenseInfo, buildVerifyResponse, renewalPlans,
  createFreeLicense, linkDevice, loadWithDevices, logAccess, daysRemaining
};
