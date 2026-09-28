const { request, app, models, api, resetDb, makeLicense } = require('./helpers');
const paypal = require('paypal-rest-sdk');
const { bootstrapAdmin } = require('../utils/adminBootstrap');
const { problems } = require('../utils/startupChecks');
const { requireApiKey } = require('../middleware/auth');

beforeEach(resetDb);
afterEach(() => jest.restoreAllMocks());
afterAll(() => models.sequelize.close());

describe('admin inicial', () => {
  test('sin ADMIN_INITIAL_PASSWORD no se crea ningún admin', async () => {
    const r = await bootstrapAdmin(models.Admin, { ADMIN_DEFAULT_EMAIL: 'a@b.com' });
    expect(r).toEqual({ created: false, reason: 'missing_password' });
    expect(await models.Admin.count()).toBe(0);
  });
  test('contraseña corta se rechaza', async () => {
    await expect(bootstrapAdmin(models.Admin, { ADMIN_INITIAL_PASSWORD: 'corta', ADMIN_DEFAULT_EMAIL: 'a@b.com' })).rejects.toThrow('12');
  });
  test('con variables crea el superadmin una sola vez', async () => {
    const env = { ADMIN_INITIAL_PASSWORD: 'una-clave-larga-y-segura', ADMIN_DEFAULT_EMAIL: 'admin@monterlabs.test' };
    expect((await bootstrapAdmin(models.Admin, env)).created).toBe(true);
    expect((await bootstrapAdmin(models.Admin, env)).created).toBe(false);
    const admin = await models.Admin.findOne();
    expect(admin.role).toBe('superadmin');
    expect(admin.access_code).toBeNull();
  });
});

describe('arranque', () => {
  const good = { NODE_ENV: 'production', SESSION_SECRET: 's'.repeat(40), JWT_SECRET: 'j'.repeat(40), API_KEY: 'k'.repeat(40) };
  test('configuración correcta no reporta problemas', () => { expect(problems(good)).toEqual([]); });
  test('secretos de ejemplo se detectan', () => {
    expect(problems({ ...good, SESSION_SECRET: 'change_this_super_secret_session_key_now_12345' })).toHaveLength(1);
  });
  test('la API key filtrada en green-kraken se rechaza', () => {
    expect(problems({ ...good, API_KEY: '27cdb56bcb3284598f3352b410fdec0c823d696f' })[0]).toContain('filtrada');
  });
  test('producción sin API_KEY se reporta', () => {
    const { API_KEY, ...rest } = good;
    expect(problems(rest)).toHaveLength(1);
  });
});

test('requireApiKey en producción sin API_KEY responde 503', () => {
  const saved = { key: process.env.API_KEY, env: process.env.NODE_ENV };
  delete process.env.API_KEY; process.env.NODE_ENV = 'production';
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  requireApiKey({ get: () => '' }, res, next);
  process.env.API_KEY = saved.key; process.env.NODE_ENV = saved.env;
  expect(res.status).toHaveBeenCalledWith(503);
  expect(next).not.toHaveBeenCalled();
});

describe('PayPal', () => {
  const executed = (license, plan, total) => ({
    state: 'approved', payer: { payer_info: { email: 'x@y.com' } },
    transactions: [{ custom: JSON.stringify({ license_id: String(license.id), plan_type: plan }), amount: { total: String(total), currency: 'USD' } }]
  });

  test('toma licencia y plan del pago, no de la URL', async () => {
    const mine = await makeLicense();
    const other = await makeLicense({ email: 'otro@example.com' }, ['device-x']);
    jest.spyOn(paypal.payment, 'execute').mockImplementation((id, body, cb) => cb(null, executed(mine, 'monthly', 7)));
    const res = await request(app).get(`/payments/paypal/success?paymentId=PAY-1&PayerID=P1&license_id=${other.id}&plan_type=annual`);
    expect(res.status).toBe(302);
    await mine.reload(); await other.reload();
    expect(mine).toMatchObject({ license_type: 'pro', plan_type: 'monthly' });
    expect(other.license_type).toBe('free');
  });

  test('repetir el mismo paymentId no vuelve a aplicar', async () => {
    const lic = await makeLicense();
    const exec = jest.spyOn(paypal.payment, 'execute').mockImplementation((id, body, cb) => cb(null, executed(lic, 'monthly', 7)));
    await request(app).get('/payments/paypal/success?paymentId=PAY-2&PayerID=P1');
    await request(app).get('/payments/paypal/success?paymentId=PAY-2&PayerID=P1');
    expect(exec).toHaveBeenCalledTimes(1);
    expect(await models.Payment.count()).toBe(1);
  });

  test('monto menor al precio no activa PRO', async () => {
    const lic = await makeLicense();
    jest.spyOn(paypal.payment, 'execute').mockImplementation((id, body, cb) => cb(null, executed(lic, 'annual', 7)));
    await request(app).get('/payments/paypal/success?paymentId=PAY-3&PayerID=P1');
    await lic.reload();
    expect(lic.license_type).toBe('free');
  });
});

test('webhook de Coinbase sin firma válida responde 400', async () => {
  const res = await request(app).post('/payments/webhook/bitcoin').set('Content-Type', 'application/json').set('X-CC-Webhook-Signature', 'mala').send('{"event":{}}');
  expect(res.status).toBe(400);
});

test('API de admin: upgrade por JWT conserva la clave y responde JSON', async () => {
  const bcrypt = require('bcryptjs');
  await models.Admin.create({ username: 'root', email: 'root@x.com', phone: '+1', password_hash: await bcrypt.hash('una-clave-larga-y-segura', 4), is_active: true, role: 'superadmin' });
  const login = await request(app).post('/api/v1/auth/login').send({ username: 'root', password: 'una-clave-larga-y-segura' });
  expect(login.body.token).toBeDefined();
  const lic = await makeLicense();
  const res = await request(app).post(`/api/v1/licenses/${lic.id}/upgrade`).set('Authorization', `Bearer ${login.body.token}`).set('Content-Type', 'application/json; charset=utf-8').send({ plan_type: 'monthly' });
  expect(res.status).toBe(200);
  expect(res.body.license).toMatchObject({ license_key: lic.license_key, license_type: 'pro', plan_type: 'monthly' });
  const upd = await request(app).put(`/api/v1/licenses/${lic.id}`).set('Authorization', `Bearer ${login.body.token}`).send({ max_devices: 3 });
  expect(upd.body.license.max_devices).toBe(3);
  expect(api).toBeDefined();
});
