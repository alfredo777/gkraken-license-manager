// Panel de administración del plan de IA: proveedores (clave cifrada), modelos,
// planes, suscripciones y reporte de consumo con costo y margen.
const { Op, fn, col, literal } = require('sequelize');
const { AiProvider, AiModel, AiPlan, AiSubscription, AiUsage, License } = require('../models');
const { setProviderKey, isConfigured } = require('../utils/secretBox');

const API_FORMATS = ['anthropic', 'openai', 'gemini'];
const num = (v, d = 0) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const back = (res, anchor) => res.redirect(`/dashboard/ai#${anchor}`);

exports.index = async (req, res) => {
  const since = new Date(Date.now() - 30 * 864e5);
  const [providers, models, plans, subscriptions, byModel, totals] = await Promise.all([
    AiProvider.findAll({ order: [['name', 'ASC']] }),
    AiModel.findAll({ include: [{ model: AiProvider, as: 'provider' }], order: [['provider_id', 'ASC'], ['display_name', 'ASC']] }),
    AiPlan.findAll({ order: [['sort_order', 'ASC'], ['price_monthly', 'ASC']] }),
    AiSubscription.findAll({ include: [{ model: AiPlan, as: 'plan' }, { model: License, as: 'license', attributes: ['id', 'email', 'name', 'license_key'] }], order: [['updated_at', 'DESC']], limit: 100 }),
    AiUsage.findAll({
      where: { created_at: { [Op.gte]: since } }, group: ['ai_model_id'], raw: true,
      attributes: ['ai_model_id', [fn('COUNT', col('id')), 'requests'], [fn('SUM', col('input_tokens')), 'input'], [fn('SUM', col('output_tokens')), 'output'], [fn('SUM', col('billed_tokens')), 'billed'], [fn('SUM', col('cost_micros')), 'cost']]
    }),
    AiSubscription.findAll({ where: { status: 'active', period_end: { [Op.gt]: new Date() } }, include: [{ model: AiPlan, as: 'plan' }] })
  ]);
  const modelName = Object.fromEntries(models.map(m => [m.id, `${m.provider?.name || ''} · ${m.display_name}`]));
  const report = byModel.map(r => ({ model: modelName[r.ai_model_id] || `#${r.ai_model_id}`, requests: Number(r.requests), input: Number(r.input), output: Number(r.output), billed: Number(r.billed), costUsd: (Number(r.cost) / 1e6).toFixed(2) }));
  const monthlyRevenue = totals.reduce((sum, s) => sum + Number(s.plan?.price_monthly || 0), 0);
  const costUsd = byModel.reduce((sum, r) => sum + Number(r.cost || 0), 0) / 1e6;
  res.render('ai/index', {
    layout: 'main', title: 'IA de Green Kraken',
    masterKeyReady: isConfigured(), apiFormats: API_FORMATS,
    providers: providers.map(p => ({ ...p.toJSON(), hasKey: Boolean(p.key_ciphertext) })),
    models: models.map(m => m.toJSON()),
    plans: plans.map(p => ({ ...p.toJSON(), allowedList: p.allowed_models })),
    subscriptions: subscriptions.map(s => s.toJSON()),
    report,
    summary: { activeSubscriptions: totals.length, monthlyRevenue: monthlyRevenue.toFixed(2), costUsd: costUsd.toFixed(2), margin: (monthlyRevenue - costUsd).toFixed(2) }
  });
};

exports.saveProvider = async (req, res) => {
  const b = req.body;
  const data = { name: String(b.name || '').trim(), slug: String(b.slug || '').trim().toLowerCase(), api_format: b.api_format, base_url: String(b.base_url || '').trim(), enabled: b.enabled === 'on' };
  if (!data.name || !/^[a-z0-9-]{2,40}$/.test(data.slug) || !API_FORMATS.includes(data.api_format) || !/^https?:\/\//.test(data.base_url)) {
    req.flash('error_msg', 'Revisa nombre, identificador (a-z, 0-9, -), formato y URL.'); return back(res, 'proveedores');
  }
  let provider = req.params.id ? await AiProvider.findByPk(req.params.id) : null;
  try {
    if (provider) await provider.update(data); else provider = await AiProvider.create(data);
    if (b.api_key && String(b.api_key).trim()) {
      if (!isConfigured()) { req.flash('error_msg', 'Falta AI_KEYS_MASTER_KEY en el servidor: no se puede guardar la clave.'); return back(res, 'proveedores'); }
      await setProviderKey(provider, String(b.api_key).trim());
    }
    req.flash('success_msg', `Proveedor ${provider.name} guardado.`);
  } catch (error) { req.flash('error_msg', `No se pudo guardar: ${error.message}`); }
  return back(res, 'proveedores');
};

exports.saveModel = async (req, res) => {
  const b = req.body;
  const data = {
    provider_id: num(b.provider_id), model_id: String(b.model_id || '').trim(), display_name: String(b.display_name || '').trim(),
    cost_input_per_mtok: num(b.cost_input_per_mtok), cost_output_per_mtok: num(b.cost_output_per_mtok),
    token_factor: Math.max(0.01, num(b.token_factor, 1)), max_output_tokens: Math.max(1, Math.round(num(b.max_output_tokens, 8192))), enabled: b.enabled === 'on'
  };
  if (!data.provider_id || !data.model_id || !data.display_name) { req.flash('error_msg', 'Proveedor, id y nombre del modelo son requeridos.'); return back(res, 'modelos'); }
  try {
    const model = req.params.id ? await AiModel.findByPk(req.params.id) : null;
    if (model) await model.update(data); else await AiModel.create(data);
    req.flash('success_msg', `Modelo ${data.display_name} guardado.`);
  } catch (error) { req.flash('error_msg', `No se pudo guardar: ${error.message}`); }
  return back(res, 'modelos');
};

exports.savePlan = async (req, res) => {
  const b = req.body;
  let allowed = String(b.allowed_models || '*').trim() || '*';
  if (allowed !== '*') {
    const ids = allowed.split(/[\s,]+/).map(Number).filter(n => Number.isInteger(n) && n > 0);
    allowed = ids.length ? JSON.stringify(ids) : '*';
  }
  const data = {
    name: String(b.name || '').trim(), slug: String(b.slug || '').trim().toLowerCase(), description: String(b.description || '').trim() || null,
    price_monthly: num(b.price_monthly), monthly_tokens: Math.round(num(b.monthly_tokens)), allowed_models: allowed,
    rpm: Math.round(num(b.rpm, 30)), max_concurrent: Math.round(num(b.max_concurrent, 3)), sort_order: Math.round(num(b.sort_order)), enabled: b.enabled === 'on'
  };
  if (!data.name || !/^[a-z0-9-]{2,40}$/.test(data.slug) || data.price_monthly <= 0 || data.monthly_tokens <= 0) {
    req.flash('error_msg', 'Nombre, identificador, precio y tokens del plan son requeridos.'); return back(res, 'planes');
  }
  try {
    const plan = req.params.id ? await AiPlan.findByPk(req.params.id) : null;
    if (plan) await plan.update(data); else await AiPlan.create(data);
    req.flash('success_msg', `Plan ${data.name} guardado. Los cambios de tokens aplican al siguiente periodo de cada suscripción.`);
  } catch (error) { req.flash('error_msg', `No se pudo guardar: ${error.message}`); }
  return back(res, 'planes');
};

// Regalo o ajuste manual de tokens a una suscripción (soporte).
exports.adjustSubscription = async (req, res) => {
  const sub = await AiSubscription.findByPk(req.params.id);
  const delta = Math.round(num(req.body.tokens));
  if (!sub || !delta) { req.flash('error_msg', 'Indica cuántos tokens agregar (o quitar con número negativo).'); return back(res, 'suscripciones'); }
  await sub.update({ tokens_limit: literal(`CASE WHEN tokens_limit + (${delta}) < 0 THEN 0 ELSE tokens_limit + (${delta}) END`) });
  req.flash('success_msg', `Límite ajustado en ${delta} tokens.`);
  return back(res, 'suscripciones');
};

