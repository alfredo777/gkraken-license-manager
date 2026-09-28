// API que consume la app Green Kraken (lib/services/license_api_service.dart).
// Todas las rutas van detrás de requireApiKey (cabecera X-API-Key).
const { License } = require('../models');
const { getClientIp, getGeoData } = require('../middleware/ipTracker');
const { getStripe } = require('../utils/stripeClient');
const { PRICES, CURRENCY, featuresFor } = require('../config/features');
const { PLAN_TYPES } = require('../utils/applyUpgrade');
const svc = require('../utils/licenseService');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ctxFrom = (req) => { const ip = getClientIp(req); return { ip, geo: getGeoData(ip), userAgent: req.headers['user-agent'] }; };
const fail = (res, status, message) => res.status(status).json({ success: false, error: message, message });

// POST /register: alta por formulario. Desactivada salvo ALLOW_FORM_REGISTRATION=true;
// el camino normal es el login con Google (/auth/google/start).
exports.register = async (req, res) => {
  if (process.env.ALLOW_FORM_REGISTRATION !== 'true') {
    return fail(res, 403, 'El registro por formulario está desactivado. Inicia sesión con Google.');
  }
  try {
    const { name, email, device_id } = req.body || {};
    if (!name || !email || !device_id) return fail(res, 400, 'name, email y device_id son requeridos.');
    if (!EMAIL_RE.test(email)) return fail(res, 400, 'Email inválido.');
    const ctx = ctxFrom(req);
    const existing = await svc.loadWithDevices({ email: email.trim().toLowerCase() });
    if (existing) {
      const linked = (existing.devices || []).some(d => d.is_active && d.device_id === device_id);
      if (!linked) return fail(res, 409, 'Ya existe una licencia con este email en otro dispositivo. Usa migrar.');
      return res.json({ success: true, is_new: false, license: svc.buildLicenseInfo(existing), message: 'Licencia existente.' });
    }
    const license = await svc.createFreeLicense(req.body, req.body, ctx);
    return res.status(201).json({ success: true, is_new: true, license: svc.buildLicenseInfo(license), message: 'Licencia creada.' });
  } catch (error) {
    console.error('Register error:', error.message);
    return fail(res, 500, 'Error del servidor.');
  }
};

// POST /verify
exports.verify = async (req, res) => {
  try {
    const { license_key, device_id, app_version } = req.body || {};
    if (!license_key || !device_id) return res.status(400).json({ valid: false, error: 'license_key y device_id son requeridos.' });
    const ctx = ctxFrom(req);
    const license = await svc.loadWithDevices({ license_key });
    if (license) {
      const update = { last_verification_ip: ctx.ip, last_verification_at: new Date(), total_verifications: (license.total_verifications || 0) + 1 };
      if (license.status === 'active' && license.end_date && new Date(license.end_date) < new Date() && !license.auto_renew) update.status = 'expired';
      if (app_version) { update.app_version = String(app_version).slice(0, 20); if (update.app_version !== license.app_version) update.last_app_update = new Date(); }
      await license.update(update);
      const current = (license.devices || []).find(d => d.is_active && d.device_id === device_id);
      if (current) await current.update({ last_seen: new Date() });
    }
    const response = svc.buildVerifyResponse(license, device_id);
    if (license) await svc.logAccess(license, 'verification', ctx, { device_id, app_version: app_version || license.app_version, response_status: response.valid });
    return res.json(response);
  } catch (error) {
    console.error('Verification error:', error.message);
    return res.status(500).json({ valid: false, error: 'Error del servidor.' });
  }
};

// POST /migrate: reemplazado por el login con Google (mode=migrate), que prueba
// que quien migra es el dueño de la cuenta. Saber el email ya no basta.
exports.migrate = (req, res) => fail(res, 410, 'La migración ahora se hace iniciando sesión con Google (POST /api/v1/auth/google/start con mode=migrate).');

// POST /upgrade/checkout
exports.checkout = async (req, res) => {
  try {
    const { license_key, plan_type } = req.body || {};
    if (!license_key || !PLAN_TYPES.includes(plan_type)) return fail(res, 400, 'license_key y plan_type (monthly|annual) son requeridos.');
    const license = await License.findOne({ where: { license_key } });
    if (!license) return fail(res, 404, 'Licencia no encontrada.');
    if (['cancelled', 'suspended'].includes(license.status)) return fail(res, 403, `Licencia ${license.status}.`);
    const amount = PRICES[plan_type];
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      customer_email: license.stripe_customer_id ? undefined : license.email,
      customer: license.stripe_customer_id || undefined,
      line_items: [{ quantity: 1, price_data: { currency: CURRENCY.toLowerCase(), unit_amount: Math.round(amount * 100), product_data: { name: `Green Kraken PRO (${plan_type === 'annual' ? 'anual' : 'mensual'})` } } }],
      metadata: { license_id: String(license.id), plan_type },
      payment_intent_data: { metadata: { license_id: String(license.id), plan_type, source: 'checkout' } },
      success_url: `${appUrl}/payments/success`,
      cancel_url: `${appUrl}/payments/checkout?plan=${plan_type}`
    });
    return res.json({
      success: true, checkout_url: session.url, session_id: session.id, amount, plan_type, currency: CURRENCY,
      expires_at: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null
    });
  } catch (error) {
    console.error('Checkout error:', error.message);
    return fail(res, 500, 'No se pudo iniciar el pago.');
  }
};

// GET /upgrade/status/:license_key
exports.upgradeStatus = async (req, res) => {
  try {
    const license = await License.findOne({ where: { license_key: req.params.license_key } });
    if (!license) return fail(res, 404, 'Licencia no encontrada.');
    const info = svc.buildLicenseInfo(license);
    const isPro = license.license_type === 'pro' && info.status === 'active';
    return res.json({ success: true, is_pro: isPro, ...info, features: featuresFor(license), message: isPro ? 'Licencia PRO activa.' : 'Pago pendiente.' });
  } catch (error) {
    console.error('Upgrade status error:', error.message);
    return fail(res, 500, 'Error del servidor.');
  }
};
