// App del gateway de IA de Green Kraken. Corre como proceso aparte (gateway.js)
// para que el tráfico de IA no afecte la web, el panel ni las licencias.
const express = require('express');
const helmet = require('helmet');
const { handler } = require('./gateway/pipeline');
const { tokenFrom, resolveToken, catalog, planAllows } = require('./gateway/auth');
const quota = require('./gateway/quota');
const anthropic = require('./gateway/adapters/anthropic');
const openai = require('./gateway/adapters/openai');
const gemini = require('./gateway/adapters/gemini');

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: process.env.AI_GATEWAY_BODY_LIMIT || '25mb' }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/v1/anthropic/messages', wrap(handler(anthropic)));
app.post('/v1/openai/:provider/chat/completions', wrap(handler(openai)));
app.post(/^\/v1\/gemini\/models\/([^/:]+):(generateContent|streamGenerateContent)$/, wrap(handler(gemini)));

// Rutas de cada formato dentro del gateway (la app las arma con su base URL).
const pathFor = (m) => m.provider.api_format === 'anthropic' ? '/v1/anthropic/messages'
  : m.provider.api_format === 'gemini' ? `/v1/gemini/models/${m.model_id}:generateContent`
  : `/v1/openai/${m.provider.slug}/chat/completions`;

// Modelos que puede usar este token según su plan.
app.get('/v1/models', wrap(async (req, res) => {
  const ctx = await resolveToken(tokenFrom(req));
  if (!ctx) return res.status(401).json({ error: { message: 'Token inválido.' } });
  const models = (await catalog()).filter(m => planAllows(ctx.plan, m)).map(m => ({
    id: m.model_id, name: m.display_name, provider: m.provider.slug, provider_name: m.provider.name,
    api_format: m.provider.api_format, path: pathFor(m), token_factor: Number(m.token_factor), max_output_tokens: m.max_output_tokens
  }));
  res.json({ data: models, has_plan: Boolean(ctx.plan) });
}));

// Consumo del periodo actual.
app.get('/v1/usage', wrap(async (req, res) => {
  const ctx = await resolveToken(tokenFrom(req));
  if (!ctx) return res.status(401).json({ error: { message: 'Token inválido.' } });
  const s = ctx.subscription;
  if (!s) return res.json({ has_plan: false });
  const fresh = await s.constructor.findByPk(s.id);
  // tokens_used incluye lo que esta copia tiene prestado sin gastar; se descuenta.
  const used = Math.max(0, Number(fresh.tokens_used) - quota.unspent(fresh));
  res.json({
    has_plan: true, plan: ctx.plan.name, tokens_used: used, tokens_limit: Number(fresh.tokens_limit),
    tokens_remaining: Math.max(0, Number(fresh.tokens_limit) - used), period_end: fresh.period_end, cancel_at_period_end: fresh.cancel_at_period_end
  });
}));

app.use((req, res) => res.status(404).json({ error: { message: 'Ruta no encontrada.' } }));
app.use((err, req, res, next) => {
  console.error('Gateway error:', err.message);
  if (res.headersSent) return res.end();
  res.status(err.type === 'entity.too.large' ? 413 : 500).json({ error: { message: 'Error interno del gateway.' } });
});

module.exports = app;
