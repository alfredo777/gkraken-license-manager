// Cada petición de IA pasa por aquí: token → plan → modelo → límites → reserva
// de tokens → se descifra la clave del proveedor → se reenvía → se cobra lo real.
const { tokenFrom, resolveToken, catalog, planAllows } = require('./auth');
const limits = require('./limits');
const quota = require('./quota');
const usageLog = require('./usageLog');
const { providerKey } = require('../utils/secretBox');

const estimateTokens = (value) => Math.ceil(JSON.stringify(value || '').length / 4);

const handler = (adapter) => async (req, res) => {
  const fail = (status, message, extraHeaders = {}) => {
    for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
    return res.status(status).json(adapter.errorBody(status, message));
  };

  const ctx = await resolveToken(tokenFrom(req));
  if (!ctx) return fail(401, 'Token de Green Kraken inválido o revocado. Inicia sesión de nuevo en la app.');
  if (!ctx.subscription) return fail(402, 'Tu cuenta no tiene un plan de IA activo. Suscríbete en Mi cuenta.');

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const target = adapter.target(req, body);
  const model = (await catalog()).find(m => m.model_id === target.modelId && m.provider.api_format === adapter.format
    && (!target.providerSlug || m.provider.slug === target.providerSlug));
  if (!model) return fail(404, `El modelo "${target.modelId || ''}" no está disponible en Green Kraken.`);
  if (!planAllows(ctx.plan, model)) return fail(403, `Tu plan "${ctx.plan.name}" no incluye ${model.display_name}.`);

  const slot = limits.tryAcquire(ctx.token.id, { rpm: ctx.plan.rpm, maxConcurrent: ctx.plan.max_concurrent });
  if (!slot.ok) return fail(429, slot.reason, { 'Retry-After': String(slot.retryAfter) });

  const started = Date.now();
  const factor = Number(model.token_factor) || 1;
  const prepared = adapter.prepare(body, model);
  const inputEstimate = estimateTokens(prepared.inputForEstimate);
  const reserved = Math.ceil((inputEstimate + prepared.maxOutput) * factor);
  const meter = { input: 0, output: 0, textChars: 0, measured: false, status: 'ok', httpStatus: 200, error: null };

  try {
    if (!(await quota.reserve(ctx.subscription, reserved))) {
      return fail(402, 'Se acabaron los tokens de tu plan de IA para este mes.');
    }
    let apiKey;
    try { apiKey = providerKey(model.provider); } catch (e) { apiKey = null; }
    if (!apiKey) {
      await quota.settle(ctx.subscription, reserved, 0);
      return fail(503, `${model.provider.name} no está disponible en este momento.`);
    }

    const controller = new AbortController();
    res.on('close', () => { if (!res.writableFinished) { meter.status = 'aborted'; controller.abort(); } });

    try {
      await adapter.forward({ req, res, body: prepared.body, provider: model.provider, model, apiKey, signal: controller.signal, meter });
    } catch (error) {
      if (meter.status !== 'aborted') { meter.status = 'error'; meter.error = String(error.message || error).slice(0, 255); }
      if (!res.headersSent) fail(502, 'No se pudo contactar al proveedor de IA.');
      else if (!res.writableEnded) res.end();
    }

    // Sin cifras del proveedor se estima; si el proveedor rechazó la petición no se cobra.
    if (!meter.measured) {
      if (meter.httpStatus >= 400 && meter.textChars === 0) { meter.input = 0; meter.output = 0; }
      else { meter.input = inputEstimate; meter.output = Math.ceil(meter.textChars / 4); if (meter.status === 'ok') meter.status = 'estimated'; }
    }
    if (meter.httpStatus >= 400 && meter.status === 'ok') meter.status = 'error';
    const billed = Math.ceil((meter.input + meter.output) * factor);
    await quota.settle(ctx.subscription, reserved, billed);
    usageLog.record({
      license_id: ctx.license.id, subscription_id: ctx.subscription.id, token_id: ctx.token.id, ai_model_id: model.id,
      input_tokens: meter.input, output_tokens: meter.output, billed_tokens: billed,
      cost_micros: Math.round(meter.input * Number(model.cost_input_per_mtok) + meter.output * Number(model.cost_output_per_mtok)),
      status: meter.status, http_status: meter.httpStatus, latency_ms: Date.now() - started, error: meter.error
    });
  } finally {
    slot.release();
  }
};

module.exports = { handler, estimateTokens };
