// Cuenta web del usuario de Green Kraken (/cuenta): entra con Google, ve su
// licencia y sus dispositivos, libera un equipo y paga el plan PRO.
// Si la cuenta de Google no tiene licencia, se crea una FREE al entrar.
const crypto = require('crypto');
const { License, Device, Payment } = require('../models');
const { getClientIp, getGeoData } = require('../middleware/ipTracker');
const google = require('../utils/googleOAuth');
const svc = require('../utils/licenseService');
const { createCheckoutSession } = require('../utils/checkoutSession');
const { PRICES, CURRENCY, featuresFor } = require('../config/features');
const { PLAN_TYPES } = require('../utils/applyUpgrade');
const { AiPlan, AiToken } = require('../models');
const aiBilling = require('../utils/aiBilling');
const { revokeDeviceTokens } = require('../utils/aiTokens');

const fmtTokens = (n) => new Intl.NumberFormat('es-MX').format(Number(n) || 0);

const WEB_AUTH_TTL_MS = 10 * 60 * 1000;
const ctxFrom = (req) => { const ip = getClientIp(req); return { ip, geo: getGeoData(ip), userAgent: req.headers['user-agent'] }; };
const appUrlFrom = (req) => process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
const saveSession = (req) => new Promise((resolve, reject) => req.session.save(e => (e ? reject(e) : resolve())));
const regenerateSession = (req) => new Promise((resolve, reject) => req.session.regenerate(e => (e ? reject(e) : resolve())));
const renderLogin = (res, status, message) => res.status(status).render('account/login', { layout: 'site', title: 'Entrar', message, googleReady: google.isConfigured() });

exports.requireCustomer = (req, res, next) => {
  if (req.session?.customer?.license_id) return next();
  return res.redirect('/cuenta/entrar');
};

// Token anti-CSRF para los formularios de la cuenta.
exports.csrf = (req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('base64url');
  res.locals.csrf = req.session.csrf;
  if (req.method === 'POST') {
    const given = Buffer.from(String(req.body?._csrf || ''));
    const expected = Buffer.from(req.session.csrf);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      return res.status(403).render('auth/done', { layout: 'site', title: 'Green Kraken', ok: false, message: 'La sesión expiró. Recarga la página.' });
    }
  }
  next();
};

// GET /cuenta/entrar: página de entrada; con ?go=1 salta directo a Google.
exports.loginPage = async (req, res) => {
  if (req.session?.customer?.license_id) return res.redirect('/cuenta');
  if (!req.query.go) return renderLogin(res, 200);
  if (!google.isConfigured()) return renderLogin(res, 503, 'El inicio de sesión con Google todavía no está configurado.');
  const state = google.randomToken(32);
  const verifier = google.randomToken(64);
  req.session.webAuth = { state, verifier, expires: Date.now() + WEB_AUTH_TTL_MS };
  await saveSession(req);
  return res.redirect(google.buildAuthUrl(state, verifier));
};

// ¿Este callback de Google pertenece al login web (y no a la app)?
exports.isWebCallback = (req) => Boolean(req.session?.webAuth && req.query.state && req.session.webAuth.state === String(req.query.state));

// Llamado desde /auth/google/callback cuando el state es del login web.
exports.finishWebLogin = async (req, res) => {
  const { verifier, expires } = req.session.webAuth;
  delete req.session.webAuth;
  if (Date.now() > expires) return renderLogin(res, 410, 'El inicio de sesión tardó demasiado. Inténtalo de nuevo.');
  if (req.query.error || !req.query.code) return renderLogin(res, 400, req.query.error === 'access_denied' ? 'Cancelaste el inicio de sesión.' : 'Google no autorizó el inicio de sesión.');
  try {
    const profile = await google.exchangeCode(String(req.query.code), verifier);
    if (!profile.email || !profile.email_verified) return renderLogin(res, 403, 'Tu email de Google no está verificado.');
    const { license, isNew } = await svc.findOrCreateForGoogle(profile, null, ctxFrom(req));
    await regenerateSession(req);
    req.session.customer = { license_id: license.id, name: profile.name || license.name, email: license.email, avatar: profile.picture || license.avatar_url };
    if (isNew) req.flash('success_msg', '¡Bienvenido! Creamos tu licencia gratuita de Green Kraken.');
    await saveSession(req);
    return res.redirect('/cuenta');
  } catch (error) {
    if (!error.expose) console.error('Web login error:', error.message);
    return renderLogin(res, error.expose ? 409 : 500, error.expose ? error.message : 'No se pudo completar el inicio de sesión.');
  }
};

// GET /cuenta
exports.index = async (req, res) => {
  const license = await License.findByPk(req.session.customer.license_id, {
    include: [{ model: Device, as: 'devices', required: false }, { model: Payment, as: 'payments', required: false }]
  });
  if (!license) { req.session.customer = null; return res.redirect('/cuenta/entrar'); }
  const status = svc.clientStatus(license);
  const devices = (license.devices || []).filter(d => d.is_active).map(d => d.toJSON());
  const aiSub = await aiBilling.activeSubscription(license.id);
  const aiPlans = (await AiPlan.findAll({ where: { enabled: true }, order: [['sort_order', 'ASC'], ['price_monthly', 'ASC']] }))
    .map(p => ({ ...p.toJSON(), tokensLabel: fmtTokens(p.monthly_tokens), isCurrent: aiSub?.plan_id === p.id }));
  const aiTokens = (await AiToken.findAll({ where: { license_id: license.id, revoked_at: null }, order: [['created_at', 'DESC']] })).map(t => t.toJSON());
  const used = Number(aiSub?.tokens_used || 0); const limit = Number(aiSub?.tokens_limit || 0);
  const ai = aiSub ? {
    plan: aiSub.plan.name, status: aiSub.status, periodEnd: aiSub.period_end, cancelAtPeriodEnd: aiSub.cancel_at_period_end,
    used: fmtTokens(used), limit: fmtTokens(limit), percent: limit ? Math.min(100, Math.round((used / limit) * 100)) : 0
  } : null;
  res.render('account/index', {
    layout: 'site', title: 'Mi cuenta · Green Kraken',
    customer: req.session.customer,
    license: license.toJSON(),
    status,
    isPro: license.license_type === 'pro' && status === 'active',
    isLifetimeFree: license.plan_type === 'free',
    daysRemaining: svc.daysRemaining(license),
    features: featuresFor(license),
    devices,
    maxDevices: license.max_devices || 1,
    payments: (license.payments || []).filter(p => p.status === 'completed').map(p => p.toJSON()).sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at)),
    priceMonthly: PRICES.monthly, priceAnnual: PRICES.annual, currencyCode: CURRENCY,
    canPay: !['cancelled', 'suspended'].includes(license.status),
    paymentOk: req.query.pago === 'ok',
    ai, aiPlans, aiTokens, aiOk: req.query.ia === 'ok'
  });
};

// POST /cuenta/dispositivos/:id/desvincular: libera un equipo para usar la licencia en otro.
exports.unlinkDevice = async (req, res) => {
  const device = await Device.findOne({ where: { id: req.params.id, license_id: req.session.customer.license_id, is_active: true } });
  if (!device) { req.flash('error_msg', 'Dispositivo no encontrado.'); return res.redirect('/cuenta'); }
  await device.update({ is_active: false });
  await revokeDeviceTokens(device.license_id, device.device_id);
  const license = await License.findByPk(req.session.customer.license_id);
  await svc.logAccess(license, 'migration', ctxFrom(req), { device_id: device.device_id });
  req.flash('success_msg', `Liberaste "${device.device_name || 'el dispositivo'}". Ya puedes iniciar sesión en otro equipo.`);
  return res.redirect('/cuenta');
};

// POST /cuenta/pro: lleva al pago de Stripe.
exports.upgrade = async (req, res) => {
  const planType = req.body.plan_type;
  if (!PLAN_TYPES.includes(planType)) { req.flash('error_msg', 'Plan inválido.'); return res.redirect('/cuenta'); }
  const license = await License.findByPk(req.session.customer.license_id);
  if (!license || ['cancelled', 'suspended'].includes(license.status)) { req.flash('error_msg', 'Tu licencia no permite pagos. Contacta a soporte.'); return res.redirect('/cuenta'); }
  try {
    const session = await createCheckoutSession(license, planType, { appUrl: appUrlFrom(req), successPath: '/cuenta?pago=ok', cancelPath: '/cuenta' });
    return res.redirect(303, session.url);
  } catch (error) {
    console.error('Account checkout error:', error.message);
    req.flash('error_msg', 'No se pudo iniciar el pago. Inténtalo más tarde.');
    return res.redirect('/cuenta');
  }
};

// POST /cuenta/ia/suscribir: plan mensual de IA con Stripe.
exports.subscribeAi = async (req, res) => {
  const plan = await AiPlan.findOne({ where: { id: Number(req.body.plan_id) || 0, enabled: true } });
  const license = await License.findByPk(req.session.customer.license_id);
  if (!plan || !license || ['cancelled', 'suspended'].includes(license.status)) { req.flash('error_msg', 'Ese plan no está disponible.'); return res.redirect('/cuenta#ia'); }
  const current = await aiBilling.activeSubscription(license.id);
  if (current && current.plan_id === plan.id && !current.cancel_at_period_end) { req.flash('error_msg', 'Ya tienes ese plan.'); return res.redirect('/cuenta#ia'); }
  try {
    const session = await aiBilling.createAiCheckout(license, plan, { appUrl: appUrlFrom(req) });
    return res.redirect(303, session.url);
  } catch (error) {
    console.error('AI checkout error:', error.message);
    req.flash('error_msg', 'No se pudo iniciar el pago. Inténtalo más tarde.');
    return res.redirect('/cuenta#ia');
  }
};

// POST /cuenta/ia/cancelar: se cancela al final del periodo ya pagado.
exports.cancelAi = async (req, res) => {
  const sub = await aiBilling.activeSubscription(req.session.customer.license_id);
  if (!sub) return res.redirect('/cuenta#ia');
  try {
    await aiBilling.cancelAtPeriodEnd(sub);
    req.flash('success_msg', 'Tu plan de IA se cancelará al terminar el periodo actual.');
  } catch (error) {
    console.error('AI cancel error:', error.message);
    req.flash('error_msg', 'No se pudo cancelar. Inténtalo más tarde.');
  }
  return res.redirect('/cuenta#ia');
};

// POST /cuenta/ia/tokens/:id/revocar: desconecta la IA de un equipo.
exports.revokeAiToken = async (req, res) => {
  const [count] = await AiToken.update({ revoked_at: new Date() }, { where: { id: Number(req.params.id) || 0, license_id: req.session.customer.license_id, revoked_at: null } });
  req.flash(count ? 'success_msg' : 'error_msg', count ? 'Desconectaste la IA de Green Kraken de ese equipo.' : 'No encontramos esa conexión.');
  return res.redirect('/cuenta#ia');
};

// POST /cuenta/salir
exports.logout = (req, res) => {
  req.session.customer = null;
  req.session.csrf = null;
  return res.redirect('/');
};
