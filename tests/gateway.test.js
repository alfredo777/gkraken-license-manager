const http = require('http');
const express = require('express');
const { request, models, resetDb, makeLicense } = require('./helpers');
const gatewayApp = require('../gatewayApp');
const { setProviderKey } = require('../utils/secretBox');
const { issueToken } = require('../utils/aiTokens');
const usageLog = require('../gateway/usageLog');
const limits = require('../gateway/limits');
const quota = require('../gateway/quota');
const { clearCaches } = require('../gateway/auth');

const REAL_KEYS = { anthropic: 'sk-ant-REAL-anthropic-1234', xai: 'xai-REAL-grok-5678', google: 'AIza-REAL-gemini-9012' };

// Proveedor falso: comprueba que llega la clave real (nunca el token del usuario).
let upstreamSeen = [];
let upstreamClosed = 0;
const fake = express();
fake.use(express.json());
fake.post('/v1/messages', (req, res) => {
  upstreamSeen.push({ provider: 'anthropic', key: req.get('x-api-key'), body: req.body });
  if (req.get('x-api-key') !== REAL_KEYS.anthropic) return res.status(401).json({ type: 'error', error: { type: 'authentication_error', message: 'bad key' } });
  if (req.body.model === 'slow') {
    res.set('Content-Type', 'text/event-stream'); res.flushHeaders();
    res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', content: [], model: 'slow', usage: { input_tokens: 10, output_tokens: 1 } } })}\n\n`);
    req.on('close', () => { upstreamClosed++; });
    return;
  }
  if (req.body.stream) {
    res.set('Content-Type', 'text/event-stream');
    const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], model: req.body.model, stop_reason: null, usage: { input_tokens: 100, cache_read_input_tokens: 20, output_tokens: 1 } } });
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Hola' } });
    ev('content_block_stop', { index: 0 });
    ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 30 } });
    ev('message_stop', {});
    return res.end();
  }
  res.json({ id: 'msg_2', type: 'message', role: 'assistant', model: req.body.model, content: [{ type: 'text', text: 'Hola' }], stop_reason: 'end_turn', usage: { input_tokens: 50, output_tokens: 10 } });
});
fake.post('/v1/chat/completions', (req, res) => {
  upstreamSeen.push({ provider: 'openai', key: req.get('authorization'), body: req.body });
  if (req.get('authorization') !== `Bearer ${REAL_KEYS.xai}`) return res.status(401).json({ error: { message: 'bad key' } });
  if (req.body.stream) {
    res.set('Content-Type', 'text/event-stream');
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Hola' } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    if (req.body.stream_options?.include_usage) res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 40, completion_tokens: 12 } })}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();
  }
  res.json({ choices: [{ message: { role: 'assistant', content: 'Hola' } }], usage: { prompt_tokens: 20, completion_tokens: 5 } });
});
fake.post(/^\/v1beta\/models\/([^/:]+):generateContent$/, (req, res) => {
  upstreamSeen.push({ provider: 'google', key: req.get('x-goog-api-key'), query: req.query, body: req.body });
  if (req.get('x-goog-api-key') !== REAL_KEYS.google) return res.status(403).json({ error: { message: 'bad key' } });
  res.json({ candidates: [{ content: { parts: [{ text: 'Hola' }] } }], usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 7 } });
});

let fakeServer; let base;
beforeAll(async () => { fakeServer = http.createServer(fake).listen(0); await new Promise(r => fakeServer.once('listening', r)); base = `http://127.0.0.1:${fakeServer.address().port}`; });
afterAll(async () => { fakeServer.close(); await models.sequelize.close(); });

let token; let sub; let claude; let grok; let gem; let plan; let license;
beforeEach(async () => {
  await usageLog.flush(); await resetDb(); clearCaches(); limits.reset(); quota.reset(); upstreamSeen = []; upstreamClosed = 0;
  const { AiProvider, AiModel, AiPlan, AiSubscription } = models;
  const pa = await AiProvider.create({ slug: 'anthropic', name: 'Anthropic', api_format: 'anthropic', base_url: base, enabled: true });
  const px = await AiProvider.create({ slug: 'xai', name: 'xAI', api_format: 'openai', base_url: `${base}/v1`, enabled: true });
  const pg = await AiProvider.create({ slug: 'google', name: 'Google', api_format: 'gemini', base_url: `${base}/v1beta`, enabled: true });
  await setProviderKey(pa, REAL_KEYS.anthropic); await setProviderKey(px, REAL_KEYS.xai); await setProviderKey(pg, REAL_KEYS.google);
  claude = await AiModel.create({ provider_id: pa.id, model_id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', cost_input_per_mtok: 4, cost_output_per_mtok: 20, token_factor: 2, max_output_tokens: 1000 });
  await AiModel.create({ provider_id: pa.id, model_id: 'slow', display_name: 'Slow', max_output_tokens: 100 });
  grok = await AiModel.create({ provider_id: px.id, model_id: 'grok-x', display_name: 'Grok', cost_input_per_mtok: 1, cost_output_per_mtok: 2, max_output_tokens: 500 });
  gem = await AiModel.create({ provider_id: pg.id, model_id: 'gemini-x', display_name: 'Gemini', max_output_tokens: 500 });
  plan = await AiPlan.create({ slug: 'basico', name: 'Básico', price_monthly: 10, monthly_tokens: 100000, rpm: 100, max_concurrent: 10 });
  license = await makeLicense();
  sub = await AiSubscription.create({ license_id: license.id, plan_id: plan.id, status: 'active', period_start: new Date(), period_end: new Date(Date.now() + 30 * 864e5), tokens_used: 0, tokens_limit: 100000 });
  token = await issueToken(license.id, 'device-aaa', 'Laptop');
});

const gw = () => request(gatewayApp);
const anthropicBody = (over = {}) => ({ model: 'claude-opus-5-5', max_tokens: 200, messages: [{ role: 'user', content: 'hola' }], ...over });

describe('autenticación y plan', () => {
  test('sin token o token inventado: 401', async () => {
    expect((await gw().post('/v1/anthropic/messages').send(anthropicBody())).status).toBe(401);
    expect((await gw().post('/v1/anthropic/messages').set('x-api-key', 'gkai_inventado').send(anthropicBody())).status).toBe(401);
  });
  test('token revocado: 401', async () => {
    await models.AiToken.update({ revoked_at: new Date() }, { where: {} });
    expect((await gw().post('/v1/anthropic/messages').set('x-api-key', token).send(anthropicBody())).status).toBe(401);
  });
  test('sin suscripción activa: 402', async () => {
    await sub.update({ period_end: new Date(Date.now() - 1000) });
    const res = await gw().post('/v1/anthropic/messages').set('x-api-key', token).send(anthropicBody());
    expect(res.status).toBe(402);
    expect(res.body.error.type).toBe('billing_error');
  });
  test('modelo fuera del plan: 403; modelo inexistente: 404', async () => {
    await plan.update({ allowed_models: JSON.stringify([grok.id]) });
    expect((await gw().post('/v1/anthropic/messages').set('x-api-key', token).send(anthropicBody())).status).toBe(403);
    expect((await gw().post('/v1/anthropic/messages').set('x-api-key', token).send(anthropicBody({ model: 'otro' }))).status).toBe(404);
  });
  test('licencia suspendida: 401', async () => {
    await license.update({ status: 'suspended' });
    expect((await gw().post('/v1/anthropic/messages').set('x-api-key', token).send(anthropicBody())).status).toBe(401);
  });
});

describe('Claude (formato Anthropic)', () => {
  test('no streaming: usa la clave real, cobra tokens × factor y registra costo', async () => {
    const res = await gw().post('/v1/anthropic/messages').set('x-api-key', token).send(anthropicBody());
    expect(res.status).toBe(200);
    expect(res.body.content[0].text).toBe('Hola');
    expect(upstreamSeen[0].key).toBe(REAL_KEYS.anthropic);
    await quota.returnLeases(true); await sub.reload();
    expect(Number(sub.tokens_used)).toBe((50 + 10) * 2);
    await usageLog.flush();
    const row = await models.AiUsage.findOne();
    expect(row).toMatchObject({ input_tokens: 50, output_tokens: 10, billed_tokens: 120, status: 'ok', cost_micros: 50 * 4 + 10 * 20 });
  });
  test('streaming: reenvía los eventos y mide con message_start/message_delta', async () => {
    const res = await gw().post('/v1/anthropic/messages').set('x-api-key', token).send(anthropicBody({ stream: true })).buffer(true).parse((r, cb) => { let d = ''; r.on('data', c => { d += c; }); r.on('end', () => cb(null, d)); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('event: message_start');
    expect(res.body).toContain('"text":"Hola"');
    expect(res.body).toContain('event: message_stop');
    await quota.returnLeases(true); await sub.reload();
    expect(Number(sub.tokens_used)).toBe((120 + 30) * 2);
  });
  test('max_tokens se limita al máximo del modelo', async () => {
    await gw().post('/v1/anthropic/messages').set('x-api-key', token).send(anthropicBody({ max_tokens: 999999 }));
    expect(upstreamSeen[0].body.max_tokens).toBe(1000);
  });
  test('clave del proveedor incorrecta: se reenvía el error y no se cobra', async () => {
    await setProviderKey(await models.AiProvider.findOne({ where: { slug: 'anthropic' } }), 'sk-ant-mala');
    clearCaches();
    const res = await gw().post('/v1/anthropic/messages').set('x-api-key', token).send(anthropicBody());
    expect(res.status).toBe(401);
    await quota.returnLeases(true); await sub.reload();
    expect(Number(sub.tokens_used)).toBe(0);
  });
  test('si el cliente corta, se cancela la petición al proveedor', async () => {
    const port = await new Promise(r => { const s = gatewayApp.listen(0, () => r(s)); });
    await new Promise((resolve) => {
      const req = http.request({ port: port.address().port, method: 'POST', path: '/v1/anthropic/messages', headers: { 'content-type': 'application/json', 'x-api-key': token } }, (res) => {
        res.once('data', () => { req.destroy(); setTimeout(resolve, 300); });
      });
      req.end(JSON.stringify({ model: 'slow', max_tokens: 50, stream: true, messages: [{ role: 'user', content: 'x' }] }));
    });
    port.close();
    expect(upstreamClosed).toBe(1);
    let row = null;
    for (let i = 0; i < 40 && !row; i++) { await usageLog.flush(); row = await models.AiUsage.findOne(); if (!row) await new Promise(r => setTimeout(r, 50)); }
    expect(row.status).toBe('aborted');
  });
});

describe('Grok (formato OpenAI)', () => {
  test('streaming: pide usage al proveedor, lo mide y no se lo manda a la app si no lo pidió', async () => {
    const res = await gw().post('/v1/openai/xai/chat/completions').set('Authorization', `Bearer ${token}`)
      .send({ model: 'grok-x', stream: true, messages: [{ role: 'user', content: 'hola' }] })
      .buffer(true).parse((r, cb) => { let d = ''; r.on('data', c => { d += c; }); r.on('end', () => cb(null, d)); });
    expect(res.status).toBe(200);
    expect(upstreamSeen[0].key).toBe(`Bearer ${REAL_KEYS.xai}`);
    expect(upstreamSeen[0].body.stream_options).toEqual({ include_usage: true });
    expect(res.body).toContain('"content":"Hola"');
    expect(res.body).toContain('[DONE]');
    expect(res.body).not.toContain('prompt_tokens');
    await quota.returnLeases(true); await sub.reload();
    expect(Number(sub.tokens_used)).toBe(52);
  });
  test('proveedor en la ruta equivocada: 404', async () => {
    const res = await gw().post('/v1/openai/openai/chat/completions').set('Authorization', `Bearer ${token}`).send({ model: 'grok-x', messages: [] });
    expect(res.status).toBe(404);
  });
});

test('Gemini: el token viaja en ?key= y se cambia por la clave real en cabecera', async () => {
  const res = await gw().post(`/v1/gemini/models/gemini-x:generateContent?key=${token}`).send({ contents: [{ parts: [{ text: 'hola' }] }] });
  expect(res.status).toBe(200);
  expect(upstreamSeen[0].key).toBe(REAL_KEYS.google);
  expect(upstreamSeen[0].query.key).toBeUndefined();
  expect(upstreamSeen[0].body.generationConfig.maxOutputTokens).toBe(500);
  await quota.returnLeases(true); await sub.reload();
  expect(Number(sub.tokens_used)).toBe(22);
});

describe('cuota y límites', () => {
  test('sin tokens suficientes para la reserva: 402', async () => {
    await sub.update({ tokens_used: 99990 });
    const res = await gw().post('/v1/anthropic/messages').set('x-api-key', token).send(anthropicBody());
    expect(res.status).toBe(402);
    expect(upstreamSeen).toHaveLength(0);
  });
  test('20 peticiones a la vez nunca pasan el límite', async () => {
    await sub.update({ tokens_limit: 3000 });
    await plan.update({ max_concurrent: 50 });
    const results = await Promise.all(Array.from({ length: 20 }, () => gw().post('/v1/anthropic/messages').set('x-api-key', token).send(anthropicBody())));
    await quota.returnLeases(true); await sub.reload();
    expect(Number(sub.tokens_used)).toBeLessThanOrEqual(3000);
    expect(results.filter(r => r.status === 402).length).toBeGreaterThan(0);
  });
  test('límite por minuto: 429 con Retry-After', async () => {
    await plan.update({ rpm: 2 });
    await gw().post('/v1/anthropic/messages').set('x-api-key', token).send(anthropicBody());
    await gw().post('/v1/anthropic/messages').set('x-api-key', token).send(anthropicBody());
    const res = await gw().post('/v1/anthropic/messages').set('x-api-key', token).send(anthropicBody());
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('información para la app', () => {
  test('/v1/models lista solo lo del plan, con la ruta de cada formato', async () => {
    await plan.update({ allowed_models: JSON.stringify([claude.id, gem.id]) });
    const res = await gw().get('/v1/models').set('Authorization', `Bearer ${token}`);
    expect(res.body.data.map(m => m.id).sort()).toEqual(['claude-opus-5-5', 'gemini-x']);
    expect(res.body.data.find(m => m.id === 'claude-opus-5-5').path).toBe('/v1/anthropic/messages');
  });
  test('/v1/usage muestra el consumo del periodo', async () => {
    await sub.update({ tokens_used: 2500 });
    const res = await gw().get('/v1/usage').set('x-api-key', token);
    expect(res.body).toMatchObject({ has_plan: true, plan: 'Básico', tokens_used: 2500, tokens_limit: 100000, tokens_remaining: 97500 });
  });
});

test('la clave del proveedor nunca se guarda ni se devuelve en claro', async () => {
  const rows = await models.AiProvider.findAll({ raw: true });
  const dump = JSON.stringify(rows);
  for (const key of Object.values(REAL_KEYS)) expect(dump).not.toContain(key);
  expect(rows.find(r => r.slug === 'anthropic').key_last4).toBe('1234');
  const res = await gw().get('/v1/models').set('Authorization', `Bearer ${token}`);
  for (const key of Object.values(REAL_KEYS)) expect(JSON.stringify(res.body)).not.toContain(key);
});

describe('préstamos de cuota', () => {
  test('varias peticiones hacen una sola escritura de reserva y lo sobrante se devuelve', async () => {
    const spy = jest.spyOn(models.AiSubscription, 'update');
    for (let i = 0; i < 5; i++) await gw().post('/v1/anthropic/messages').set('x-api-key', token).send(anthropicBody());
    const reserveWrites = spy.mock.calls.filter(c => Object.getOwnPropertySymbols(c[1].where || {}).length > 0);
    expect(reserveWrites.length).toBe(1);
    spy.mockRestore();
    await quota.returnLeases(true);
    await sub.reload();
    expect(Number(sub.tokens_used)).toBe(5 * 120);
  });
  test('/v1/usage no cuenta lo prestado sin gastar', async () => {
    await gw().post('/v1/anthropic/messages').set('x-api-key', token).send(anthropicBody());
    const res = await gw().get('/v1/usage').set('x-api-key', token);
    expect(res.body.tokens_used).toBe(120);
  });
  test('al renovar el periodo, el préstamo viejo no se devuelve al periodo nuevo', async () => {
    await gw().post('/v1/anthropic/messages').set('x-api-key', token).send(anthropicBody());
    await sub.reload();
    expect(Number(sub.tokens_used)).toBe(20000);
    await sub.update({ tokens_used: 0, period_start: new Date(Date.now() + 1000) });
    await quota.returnLeases(true);
    await sub.reload();
    expect(Number(sub.tokens_used)).toBe(0);
  });
});
