// Autenticación del gateway: token del dispositivo → licencia → suscripción → plan.
// El resultado se cachea en memoria unos segundos para no ir a la base de datos
// en cada petición (una revocación tarda como máximo CACHE_MS en aplicarse).
const { Op } = require('sequelize');
const { AiToken, License, AiSubscription, AiPlan, AiModel, AiProvider } = require('../models');
const { hashToken } = require('../utils/aiTokens');

const CACHE_MS = Number(process.env.AI_GATEWAY_CACHE_MS || 30000);
const tokenCache = new Map();
let catalogCache = { at: 0, models: [] };

const tokenFrom = (req) => {
  const auth = req.get('authorization') || '';
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  return (req.get('x-api-key') || req.get('x-goog-api-key') || req.query.key || '').trim();
};

// Devuelve { token, license, subscription|null, plan|null } o null si el token no vale.
// Peticiones simultáneas del mismo token comparten una sola consulta a la base de datos.
const inflight = new Map();

const resolveToken = async (raw) => {
  if (!raw || !raw.startsWith('gkai_')) return null;
  const hash = hashToken(raw);
  const hit = tokenCache.get(hash);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (inflight.has(hash)) return inflight.get(hash);
  const pending = lookup(hash).finally(() => inflight.delete(hash));
  inflight.set(hash, pending);
  return pending;
};

const lookup = async (hash) => {
  let value = null;
  const token = await AiToken.findOne({ where: { token_hash: hash, revoked_at: null } });
  if (token) {
    const license = await License.findByPk(token.license_id);
    if (license && !['cancelled', 'suspended'].includes(license.status)) {
      const subscription = await AiSubscription.findOne({
        where: { license_id: license.id, status: 'active', period_end: { [Op.gt]: new Date() } },
        include: [{ model: AiPlan, as: 'plan' }],
        order: [['period_end', 'DESC']]
      });
      value = { token, license, subscription, plan: subscription?.plan || null };
    }
  }
  tokenCache.set(hash, { value, expires: Date.now() + CACHE_MS });
  return value;
};

// Catálogo de modelos habilitados con su proveedor (también cacheado).
let catalogInflight = null;
const catalog = async () => {
  if (catalogCache.at + CACHE_MS > Date.now()) return catalogCache.models;
  if (!catalogInflight) {
    catalogInflight = AiModel.findAll({ where: { enabled: true }, include: [{ model: AiProvider, as: 'provider', where: { enabled: true } }] })
      .then(models => { catalogCache = { at: Date.now(), models }; return models; })
      .finally(() => { catalogInflight = null; });
  }
  return catalogInflight;
};

const planAllows = (plan, model) => {
  if (!plan) return false;
  if (!plan.allowed_models || plan.allowed_models.trim() === '*') return true;
  try { return JSON.parse(plan.allowed_models).map(Number).includes(model.id); } catch (_) { return false; }
};

const clearCaches = () => { tokenCache.clear(); catalogCache = { at: 0, models: [] }; };

module.exports = { tokenFrom, resolveToken, catalog, planAllows, clearCaches };
