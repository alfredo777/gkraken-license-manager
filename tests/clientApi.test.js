const { api, request, app, models, device, resetDb, makeLicense } = require('./helpers');
const { getStripe } = require('../utils/stripeClient');

beforeEach(resetDb);
afterAll(() => models.sequelize.close());

describe('X-API-Key', () => {
  test('sin clave responde 403', async () => {
    const res = await request(app).post('/api/v1/verify').send({ license_key: 'x', device_id: 'y' });
    expect(res.status).toBe(403);
  });
  test('clave incorrecta responde 403', async () => {
    const res = await request(app).post('/api/v1/verify').set('X-API-Key', 'otra').send({ license_key: 'x', device_id: 'y' });
    expect(res.status).toBe(403);
  });
  test('la clave en query string ya no sirve', async () => {
    const res = await request(app).post(`/api/v1/verify?api_key=${process.env.API_KEY}`).send({ license_key: 'x', device_id: 'y' });
    expect(res.status).toBe(403);
  });
});

describe('POST /verify', () => {
  test('licencia y dispositivo válidos', async () => {
    const lic = await makeLicense();
    const res = await api.post('/verify').send({ license_key: lic.license_key, device_id: 'device-aaa', app_version: '2.1.0' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      valid: true, license_key: lic.license_key, license_type: 'free', status: 'active', key_updated: false,
      status_detail: { code: 'LICENSE_VALID' }, features: ['basic_features', 'limited_exports'], max_devices: 1,
      device_link_info: { active_devices: 1, max_devices: 1, can_add_device: false, needs_migration: false },
      device_info: { device_id: 'device-aaa', is_current_device: true }
    });
    await lic.reload();
    expect(lic.app_version).toBe('2.1.0');
    expect(lic.total_verifications).toBe(1);
  });

  test('licencia inexistente → LICENSE_NOT_FOUND', async () => {
    const res = await api.post('/verify').send({ license_key: 'NOPE', device_id: 'd' });
    expect(res.body).toMatchObject({ valid: false, status_detail: { code: 'LICENSE_NOT_FOUND' } });
  });

  test.each([
    ['suspended', 'LICENSE_SUSPENDED', 'suspended'],
    ['pending', 'LICENSE_SUSPENDED', 'suspended'],
    ['cancelled', 'LICENSE_REVOKED', 'revoked']
  ])('estado %s → %s', async (status, code, clientStatus) => {
    const lic = await makeLicense({ status });
    const res = await api.post('/verify').send({ license_key: lic.license_key, device_id: 'device-aaa' });
    expect(res.body).toMatchObject({ valid: false, status: clientStatus, status_detail: { code } });
  });

  test('vencida → LICENSE_EXPIRED con planes de renovación y queda expired en BD', async () => {
    const lic = await makeLicense({ license_type: 'pro', plan_type: 'monthly', end_date: new Date(Date.now() - 3 * 864e5) });
    const res = await api.post('/verify').send({ license_key: lic.license_key, device_id: 'device-aaa' });
    expect(res.body.status_detail.code).toBe('LICENSE_EXPIRED');
    expect(res.body.renewal_plans.map(p => p.plan_type)).toEqual(['monthly', 'annual']);
    expect(res.body.fallback_features.features).toEqual(['basic_features', 'limited_exports']);
    await lic.reload();
    expect(lic.status).toBe('expired');
  });

  test('otro dispositivo → DEVICE_NOT_LINKED con needs_migration', async () => {
    const lic = await makeLicense();
    const res = await api.post('/verify').send({ license_key: lic.license_key, device_id: 'device-bbb' });
    expect(res.body).toMatchObject({ valid: false, status_detail: { code: 'DEVICE_NOT_LINKED' }, device_link_info: { needs_migration: true, can_add_device: false } });
  });

  test('otro dispositivo con cupo libre → can_add_device', async () => {
    const lic = await makeLicense({ max_devices: 2 });
    const res = await api.post('/verify').send({ license_key: lic.license_key, device_id: 'device-bbb' });
    expect(res.body.device_link_info).toMatchObject({ can_add_device: true, needs_migration: false });
  });
});

describe('POST /register (formulario)', () => {
  afterEach(() => { delete process.env.ALLOW_FORM_REGISTRATION; });

  test('desactivado por defecto', async () => {
    const res = await api.post('/register').send({ name: 'Ana', email: 'ana@example.com', ...device() });
    expect(res.status).toBe(403);
  });

  test('con ALLOW_FORM_REGISTRATION crea, reconoce reinstalación y rechaza otro dispositivo', async () => {
    process.env.ALLOW_FORM_REGISTRATION = 'true';
    const first = await api.post('/register').send({ name: 'Ana', email: 'Ana@Example.com', user_role: 'empresa', ...device() });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ success: true, is_new: true, license: { license_type: 'free', status: 'active', user_role: 'empresa' } });
    const again = await api.post('/register').send({ name: 'Ana', email: 'ana@example.com', ...device() });
    expect(again.body).toMatchObject({ is_new: false, license: { license_key: first.body.license.license_key } });
    const other = await api.post('/register').send({ name: 'Ana', email: 'ana@example.com', ...device('device-zzz') });
    expect(other.status).toBe(409);
  });
});

test('POST /migrate por email ya no existe (410)', async () => {
  const res = await api.post('/migrate').send({ license_key: 'x', email: 'ana@example.com', new_device_id: 'z' });
  expect(res.status).toBe(410);
});

describe('upgrade', () => {
  test('checkout crea sesión de Stripe con precio del servidor', async () => {
    const lic = await makeLicense();
    const create = jest.spyOn(getStripe().checkout.sessions, 'create').mockResolvedValue({ id: 'cs_test_1', url: 'https://checkout.stripe.test/cs_test_1', expires_at: 1900000000 });
    const res = await api.post('/upgrade/checkout').send({ license_key: lic.license_key, plan_type: 'annual' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, checkout_url: 'https://checkout.stripe.test/cs_test_1', session_id: 'cs_test_1', amount: 49, plan_type: 'annual', currency: 'USD' });
    const args = create.mock.calls[0][0];
    expect(args.line_items[0].price_data.unit_amount).toBe(4900);
    expect(args.metadata).toEqual({ license_id: String(lic.id), plan_type: 'annual' });
    create.mockRestore();
  });

  test('checkout rechaza plan inválido', async () => {
    const lic = await makeLicense();
    const res = await api.post('/upgrade/checkout').send({ license_key: lic.license_key, plan_type: 'lifetime' });
    expect(res.status).toBe(400);
  });

  test('webhook checkout.session.completed pasa a PRO conservando la clave, una sola vez', async () => {
    const lic = await makeLicense();
    const key = lic.license_key;
    const event = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', payment_status: 'paid', amount_total: 4900, currency: 'usd', customer: 'cus_1', payment_intent: 'pi_1', metadata: { license_id: String(lic.id), plan_type: 'annual' } } } };
    const payload = JSON.stringify(event);
    const sign = () => getStripe().webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
    const send = () => request(app).post('/webhook/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', sign()).send(payload);

    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    await lic.reload();
    expect(lic.license_key).toBe(key);
    expect(lic.license_type).toBe('pro');
    expect(lic.plan_type).toBe('annual');
    expect(await models.Payment.count()).toBe(1);

    const status = await api.get(`/upgrade/status/${key}`);
    expect(status.body).toMatchObject({ success: true, is_pro: true, license_key: key, license_type: 'pro', features: expect.arrayContaining(['advanced_features']) });
  });

  test('webhook con firma inválida responde 400', async () => {
    const res = await request(app).post('/webhook/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', 't=1,v1=bad').send('{"type":"x"}');
    expect(res.status).toBe(400);
  });
});

test('GET /license/:key no expone el nombre y exige X-API-Key', async () => {
  const lic = await makeLicense();
  expect((await request(app).get(`/api/v1/license/${lic.license_key}`)).status).toBe(403);
  const res = await api.get(`/license/${lic.license_key}`);
  expect(res.status).toBe(200);
  expect(res.body.license.name).toBeUndefined();
});
