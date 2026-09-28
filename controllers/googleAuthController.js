// Login con Google desde la app: crea la licencia FREE (mode=register) o mueve
// la licencia a este dispositivo (mode=migrate). Flujo:
//   1. App → POST /api/v1/auth/google/start          → { auth_url, session_id, poll_token }
//   2. App abre auth_url en el navegador → GET /auth/google/start/:state → Google
//   3. Google → GET /auth/google/callback             → se crea/vincula la licencia
//   4. App → GET /api/v1/auth/google/status/:id (X-Poll-Token) → resultado, una sola vez
const crypto = require('crypto');
const { Op } = require('sequelize');
const { AuthSession, Device } = require('../models');
const { getClientIp, getGeoData } = require('../middleware/ipTracker');
const google = require('../utils/googleOAuth');
const svc = require('../utils/licenseService');
const { migrateDevice } = require('../utils/deviceMigration');
const account = require('./accountController');
const { issueToken } = require('../utils/aiTokens');

const SESSION_TTL_MS = 10 * 60 * 1000;
const MODES = ['register', 'migrate'];
const DEVICE_KEYS = ['device_id', 'device_name', 'device_brand', 'device_model', 'device_os', 'device_os_version', 'device_cpu', 'device_ram', 'device_mac', 'device_board', 'device_disk_id', 'app_version', 'user_role'];
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const fail = (res, status, message) => res.status(status).json({ success: false, error: message, message });
const page = (res, status, ok, message, name) => res.status(status).render('auth/done', { layout: 'site', title: 'Green Kraken', ok, message, name });

// POST /api/v1/auth/google/start
exports.start = async (req, res) => {
  try {
    if (!google.isConfigured()) return fail(res, 503, 'El login con Google no está configurado en el servidor.');
    const body = req.body || {};
    const mode = body.mode || 'register';
    if (!MODES.includes(mode)) return fail(res, 400, 'mode debe ser register o migrate.');
    if (!body.device_id) return fail(res, 400, 'device_id es requerido.');
    const device = {};
    for (const k of DEVICE_KEYS) if (body[k] !== undefined && body[k] !== null) device[k] = String(body[k]).slice(0, 500);
    const pollToken = google.randomToken(32);
    const session = await AuthSession.create({
      state: google.randomToken(32), poll_token_hash: sha256(pollToken), code_verifier: google.randomToken(64), mode,
      device_payload: JSON.stringify(device), ip_address: getClientIp(req), expires_at: new Date(Date.now() + SESSION_TTL_MS)
    });
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    return res.status(201).json({
      success: true, session_id: session.id, poll_token: pollToken,
      auth_url: `${appUrl}/auth/google/start/${session.state}`, expires_at: session.expires_at.toISOString()
    });
  } catch (error) {
    console.error('Google start error:', error.message);
    return fail(res, 500, 'Error del servidor.');
  }
};

const pendingByState = (state) => AuthSession.findOne({ where: { state: String(state || ''), status: 'pending', expires_at: { [Op.gt]: new Date() } } });

// GET /auth/google/start/:state (navegador)
exports.redirect = async (req, res) => {
  const session = await pendingByState(req.params.state);
  if (!session) return page(res, 410, false, 'El enlace expiró o ya se usó.');
  return res.redirect(google.buildAuthUrl(session.state, session.code_verifier));
};

// Resuelve la licencia de la cuenta de Google. Devuelve el cuerpo que recibirá la app.
const resolveLicense = async (session, profile, ctx) => {
  const device = JSON.parse(session.device_payload);
  if (session.mode === 'migrate') {
    const license = await svc.findLicenseForGoogle(profile);
    if (!license) throw svc.exposed('No hay ninguna licencia para esta cuenta de Google.');
    return linkOrMigrate(session, license, device, ctx);
  }
  const { license, isNew } = await svc.findOrCreateForGoogle(profile, device, ctx);
  if (isNew) return { license, body: { success: true, is_new: true, needs_migration: false, message: 'Licencia creada.' } };
  return linkOrMigrate(session, license, device, ctx);
};

const linkOrMigrate = async (session, license, device, ctx) => {
  const active = (license.devices || []).filter(d => d.is_active);
  if (active.some(d => d.device_id === device.device_id)) {
    return { license, body: { success: true, is_new: false, needs_migration: false, message: 'Este dispositivo ya estaba vinculado.' } };
  }
  if (active.length < (license.max_devices || 1)) {
    const inactive = await Device.findOne({ where: { license_id: license.id, device_id: device.device_id } });
    if (inactive) await inactive.update({ ...svc.deviceFieldsFrom(device), is_active: true, last_seen: new Date() });
    else await svc.linkDevice(license, device, ctx);
    await svc.logAccess(license, 'registration', ctx, { device_id: device.device_id });
    return { license, body: { success: true, is_new: false, needs_migration: false, message: 'Dispositivo vinculado.' } };
  }
  if (session.mode === 'migrate') {
    const { previousDeviceId } = await migrateDevice(license, device, { reason: 'Migración con Google', migratedBy: 'user', ...ctx });
    return { license, body: { success: true, is_new: false, needs_migration: false, previous_device_id: previousDeviceId, message: 'Licencia movida a este dispositivo.' } };
  }
  return { license, body: { success: true, is_new: false, needs_migration: true, message: 'Tu licencia ya está en uso en otro dispositivo.' } };
};

// GET /auth/google/callback (navegador)
exports.callback = async (req, res) => {
  // El mismo callback sirve al login de la web (/cuenta), que guarda su state en la sesión.
  if (account.isWebCallback(req)) return account.finishWebLogin(req, res);
  const session = await pendingByState(req.query.state);
  if (!session) return page(res, 410, false, 'La sesión expiró o ya se usó.');
  const markFailed = (message) => session.update({ status: 'failed', error: String(message).slice(0, 255) });

  if (req.query.error || !req.query.code) {
    await markFailed(req.query.error === 'access_denied' ? 'Cancelaste el inicio de sesión.' : 'Google no autorizó el inicio de sesión.');
    return page(res, 400, false, session.error);
  }
  try {
    const profile = await google.exchangeCode(String(req.query.code), session.code_verifier);
    if (!profile.email || !profile.email_verified) {
      await markFailed('Tu email de Google no está verificado.');
      return page(res, 403, false, session.error);
    }
    const ip = getClientIp(req);
    const ctx = { ip, geo: getGeoData(ip), userAgent: req.headers['user-agent'] };
    const { license, body } = await resolveLicense(session, profile, ctx);
    // Token de IA de este equipo (para el plan de IA de Green Kraken). Solo si el
    // equipo quedó vinculado; viaja una sola vez en el resultado del polling.
    if (!body.needs_migration) {
      const device = JSON.parse(session.device_payload);
      body.ai_token = await issueToken(license.id, device.device_id, device.device_name);
    }
    const fresh = await svc.loadWithDevices({ id: license.id });
    await session.update({ status: 'completed', license_id: license.id, result: JSON.stringify({ ...body, license: svc.buildLicenseInfo(fresh) }) });
    return page(res, 200, true, body.needs_migration ? 'Tu licencia está en otro dispositivo; en la app podrás moverla a este.' : body.message, profile.name);
  } catch (error) {
    if (!error.expose) console.error('Google callback error:', error.message);
    await markFailed(error.expose ? error.message : 'No se pudo completar el inicio de sesión.');
    return page(res, error.expose ? 409 : 500, false, session.error);
  }
};

// GET /api/v1/auth/google/status/:id (cabecera X-Poll-Token)
exports.status = async (req, res) => {
  try {
    const token = req.get('x-poll-token') || '';
    const session = await AuthSession.findByPk(req.params.id).catch(() => null);
    const expected = session ? Buffer.from(session.poll_token_hash, 'hex') : Buffer.alloc(32);
    const given = Buffer.from(sha256(token), 'hex');
    if (!session || !token || !crypto.timingSafeEqual(expected, given)) return fail(res, 403, 'Sesión inválida.');

    if (session.status === 'pending') {
      if (new Date(session.expires_at) < new Date()) {
        await session.update({ status: 'failed', error: 'La sesión expiró.' });
        return res.json({ success: false, status: 'failed', error: session.error, message: session.error });
      }
      return res.json({ success: true, status: 'pending' });
    }
    if (session.status === 'failed') return res.json({ success: false, status: 'failed', error: session.error, message: session.error });
    if (session.status === 'completed') {
      const [claimed] = await AuthSession.update({ status: 'consumed', result: null }, { where: { id: session.id, status: 'completed' } });
      if (claimed === 1) return res.json({ status: 'completed', ...JSON.parse(session.result) });
    }
    return fail(res, 410, 'El resultado ya fue entregado.');
  } catch (error) {
    console.error('Google status error:', error.message);
    return fail(res, 500, 'Error del servidor.');
  }
};
