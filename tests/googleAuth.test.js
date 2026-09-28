const { api, request, app, models, device, resetDb, makeLicense } = require('./helpers');
const google = require('../utils/googleOAuth');

beforeEach(resetDb);
afterEach(() => jest.restoreAllMocks());
afterAll(() => models.sequelize.close());

const profile = (over = {}) => ({ sub: 'google-sub-1', email: 'ana@example.com', email_verified: true, name: 'Ana Pérez', picture: 'https://lh3.googleusercontent.com/a/ana', ...over });

// Recorre el flujo completo: start → navegador (redirect + callback) → status.
const login = async ({ mode = 'register', dev = device(), prof = profile() } = {}) => {
  jest.spyOn(google, 'exchangeCode').mockResolvedValue(prof);
  const start = await api.post('/auth/google/start').send({ mode, ...dev });
  expect(start.status).toBe(201);
  const state = start.body.auth_url.split('/').pop();
  const redirect = await request(app).get(`/auth/google/start/${state}`);
  expect(redirect.status).toBe(302);
  expect(redirect.headers.location).toContain('accounts.google.com');
  expect(redirect.headers.location).toContain('code_challenge_method=S256');
  const cb = await request(app).get(`/auth/google/callback?state=${state}&code=abc`);
  const status = await api.get(`/auth/google/status/${start.body.session_id}`).set('X-Poll-Token', start.body.poll_token);
  return { start, cb, status };
};

test('usuario nuevo: crea licencia FREE ligada a Google y al dispositivo', async () => {
  const { cb, status } = await login();
  expect(cb.status).toBe(200);
  expect(cb.text).toContain('Listo');
  expect(status.body).toMatchObject({ status: 'completed', success: true, is_new: true, needs_migration: false, license: { license_type: 'free', status: 'active', max_devices: 1 } });
  const lic = await models.License.findOne({ where: { google_sub: 'google-sub-1' } });
  expect(lic).toMatchObject({ email: 'ana@example.com', name: 'Ana Pérez', auth_provider: 'google' });
  expect(await models.Device.count({ where: { license_id: lic.id, device_id: 'device-aaa', is_active: true } })).toBe(1);
  expect((await models.Device.findOne({ where: { license_id: lic.id } })).device_motherboard).toBe('MB-1');
});

test('el resultado se entrega una sola vez', async () => {
  const { start } = await login();
  const second = await api.get(`/auth/google/status/${start.body.session_id}`).set('X-Poll-Token', start.body.poll_token);
  expect(second.status).toBe(410);
});

test('mientras no termina el login responde pending', async () => {
  const start = await api.post('/auth/google/start').send(device());
  const res = await api.get(`/auth/google/status/${start.body.session_id}`).set('X-Poll-Token', start.body.poll_token);
  expect(res.body).toEqual({ success: true, status: 'pending' });
});

test('poll token incorrecto responde 403', async () => {
  const start = await api.post('/auth/google/start').send(device());
  const res = await api.get(`/auth/google/status/${start.body.session_id}`).set('X-Poll-Token', 'otro');
  expect(res.status).toBe(403);
});

test('state desconocido no redirige a Google', async () => {
  expect((await request(app).get('/auth/google/start/inventado')).status).toBe(410);
  expect((await request(app).get('/auth/google/callback?state=inventado&code=x')).status).toBe(410);
});

test('licencia existente por email: se liga el google_sub y se reconoce el dispositivo', async () => {
  const lic = await makeLicense({ email: 'ana@example.com' });
  const { status } = await login();
  expect(status.body).toMatchObject({ is_new: false, needs_migration: false, license: { license_key: lic.license_key } });
  await lic.reload();
  expect(lic.google_sub).toBe('google-sub-1');
  expect(await models.License.count()).toBe(1);
});

test('email ligado a otra cuenta de Google se rechaza', async () => {
  await makeLicense({ email: 'ana@example.com', google_sub: 'otra-cuenta' });
  const { cb, status } = await login();
  expect(cb.status).toBe(409);
  expect(status.body).toMatchObject({ status: 'failed' });
});

test('email no verificado se rechaza', async () => {
  const { cb, status } = await login({ prof: profile({ email_verified: false }) });
  expect(cb.status).toBe(403);
  expect(status.body.status).toBe('failed');
  expect(await models.License.count()).toBe(0);
});

test('segundo dispositivo sin cupo: needs_migration; con mode=migrate se mueve', async () => {
  const lic = await makeLicense({ google_sub: 'google-sub-1' }, ['device-aaa']);
  const first = await login({ dev: device('device-bbb') });
  expect(first.status.body).toMatchObject({ needs_migration: true, license: { license_key: lic.license_key } });

  const moved = await login({ mode: 'migrate', dev: device('device-bbb') });
  expect(moved.status.body).toMatchObject({ success: true, needs_migration: false, previous_device_id: 'device-aaa' });
  const active = await models.Device.findAll({ where: { license_id: lic.id, is_active: true } });
  expect(active.map(d => d.device_id)).toEqual(['device-bbb']);
  expect(await models.DeviceMigration.count({ where: { license_id: lic.id, migrated_by: 'user' } })).toBe(1);

  const verify = await api.post('/verify').send({ license_key: lic.license_key, device_id: 'device-bbb' });
  expect(verify.body.valid).toBe(true);
});

test('segundo dispositivo con cupo se vincula sin migrar', async () => {
  const lic = await makeLicense({ google_sub: 'google-sub-1', max_devices: 2 }, ['device-aaa']);
  const { status } = await login({ dev: device('device-bbb') });
  expect(status.body).toMatchObject({ needs_migration: false });
  expect(await models.Device.count({ where: { license_id: lic.id, is_active: true } })).toBe(2);
});

test('mode=migrate sin licencia falla', async () => {
  const { status } = await login({ mode: 'migrate' });
  expect(status.body.status).toBe('failed');
  expect(await models.License.count()).toBe(0);
});

test('sesión vencida devuelve failed', async () => {
  const start = await api.post('/auth/google/start').send(device());
  await models.AuthSession.update({ expires_at: new Date(Date.now() - 1000) }, { where: { id: start.body.session_id } });
  const res = await api.get(`/auth/google/status/${start.body.session_id}`).set('X-Poll-Token', start.body.poll_token);
  expect(res.body.status).toBe('failed');
});

test('cancelar en Google marca la sesión como fallida', async () => {
  const start = await api.post('/auth/google/start').send(device());
  const state = start.body.auth_url.split('/').pop();
  const cb = await request(app).get(`/auth/google/callback?state=${state}&error=access_denied`);
  expect(cb.status).toBe(400);
  const res = await api.get(`/auth/google/status/${start.body.session_id}`).set('X-Poll-Token', start.body.poll_token);
  expect(res.body).toMatchObject({ status: 'failed', error: 'Cancelaste el inicio de sesión.' });
});

test('sin GOOGLE_CLIENT_ID responde 503', async () => {
  const saved = process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  const res = await api.post('/auth/google/start').send(device());
  process.env.GOOGLE_CLIENT_ID = saved;
  expect(res.status).toBe(503);
});
