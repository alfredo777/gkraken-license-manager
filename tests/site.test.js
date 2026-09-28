const { request, app, models, resetDb, makeLicense } = require('./helpers');
const google = require('../utils/googleOAuth');
const { getStripe } = require('../utils/stripeClient');

beforeEach(resetDb);
afterEach(() => { jest.restoreAllMocks(); delete process.env.DOWNLOAD_URL_LINUX; });
afterAll(() => models.sequelize.close());

const profile = (over = {}) => ({ sub: 'google-sub-web', email: 'luis@example.com', email_verified: true, name: 'Luis', picture: 'https://lh3.googleusercontent.com/a/luis', ...over });

// Inicia sesión en la web con una cuenta de Google simulada y devuelve el agente con la cookie.
const webLogin = async (prof = profile()) => {
  jest.spyOn(google, 'exchangeCode').mockResolvedValue(prof);
  const agent = request.agent(app);
  const go = await agent.get('/cuenta/entrar?go=1');
  expect(go.status).toBe(302);
  const state = new URL(go.headers.location).searchParams.get('state');
  const cb = await agent.get(`/auth/google/callback?state=${state}&code=abc`);
  return { agent, cb };
};
const csrfFrom = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];

describe('landing', () => {
  test('es la página de Green Kraken, con planes y sin dependencias de terceros', async () => {
    process.env.DOWNLOAD_URL_LINUX = 'https://descargas.test/gkraken.AppImage';
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Green</b> Kraken');
    expect(res.text).toContain('/cuenta/entrar?go=1');
    expect(res.text).toContain('$49');
    expect(res.text).toContain('https://descargas.test/gkraken.AppImage');
    expect(res.text).toContain('Próximamente');
    expect(res.text).toContain('/css/site.css');
    expect(res.text).not.toContain('cdn.tailwindcss.com');
  });
  test('la hoja del sitio usa los tokens de GKColors con variante clara', async () => {
    const css = await request(app).get('/css/site.css');
    expect(css.status).toBe(200);
    expect(css.text).toContain('--gk-primary:       #8BC34A');
    expect(css.text).toContain('prefers-color-scheme: light');
    expect(css.text).toContain('prefers-reduced-motion');
  });
});

describe('cuenta web', () => {
  test('sin sesión redirige a entrar', async () => {
    const res = await request(app).get('/cuenta');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/cuenta/entrar');
    expect((await request(app).get('/cuenta/entrar')).text).toContain('Continuar con Google');
  });

  test('primer login con Google crea la licencia FREE sin dispositivo', async () => {
    const { agent, cb } = await webLogin();
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('/cuenta');
    const lic = await models.License.findOne({ where: { google_sub: 'google-sub-web' } });
    expect(lic).toMatchObject({ license_type: 'free', status: 'active', auth_provider: 'google', email: 'luis@example.com' });
    expect(await models.Device.count()).toBe(0);
    const page = await agent.get('/cuenta');
    expect(page.status).toBe(200);
    expect(page.text).toContain(lic.license_key);
    expect(page.text).toContain('Creamos tu licencia gratuita');
  });

  test('la app después vincula su dispositivo a la licencia creada en la web', async () => {
    await webLogin();
    const lic = await models.License.findOne({ where: { google_sub: 'google-sub-web' } });
    const verify = await request(app).post('/api/v1/verify').set('X-API-Key', process.env.API_KEY).send({ license_key: lic.license_key, device_id: 'pc-1' });
    expect(verify.body.device_link_info).toMatchObject({ active_devices: 0, can_add_device: true });
  });

  test('licencia existente por email: se liga la cuenta y no se duplica', async () => {
    const lic = await makeLicense({ email: 'luis@example.com' });
    const { agent } = await webLogin();
    expect(await models.License.count()).toBe(1);
    expect((await agent.get('/cuenta')).text).toContain(lic.license_key);
  });

  test('state ajeno no inicia sesión', async () => {
    const agent = request.agent(app);
    await agent.get('/cuenta/entrar?go=1');
    const cb = await agent.get('/auth/google/callback?state=otro&code=abc');
    expect(cb.status).toBe(410);
    expect((await agent.get('/cuenta')).status).toBe(302);
  });

  test('email no verificado no entra', async () => {
    const { cb } = await webLogin(profile({ email_verified: false }));
    expect(cb.status).toBe(403);
    expect(await models.License.count()).toBe(0);
  });

  test('liberar un dispositivo exige el token del formulario', async () => {
    const lic = await makeLicense({ email: 'luis@example.com', google_sub: 'google-sub-web' }, ['pc-1']);
    const { agent } = await webLogin();
    const device = await models.Device.findOne({ where: { license_id: lic.id } });
    const sinToken = await agent.post(`/cuenta/dispositivos/${device.id}/desvincular`).type('form').send({});
    expect(sinToken.status).toBe(403);
    const csrf = csrfFrom((await agent.get('/cuenta')).text);
    const ok = await agent.post(`/cuenta/dispositivos/${device.id}/desvincular`).type('form').send({ _csrf: csrf });
    expect(ok.status).toBe(302);
    await device.reload();
    expect(device.is_active).toBe(false);
  });

  test('no se puede liberar el dispositivo de otra licencia', async () => {
    await makeLicense({ email: 'luis@example.com', google_sub: 'google-sub-web' }, []);
    const otra = await makeLicense({ email: 'otra@example.com' }, ['pc-ajeno']);
    const { agent } = await webLogin();
    const ajeno = await models.Device.findOne({ where: { license_id: otra.id } });
    const csrf = csrfFrom((await agent.get('/cuenta')).text);
    await agent.post(`/cuenta/dispositivos/${ajeno.id}/desvincular`).type('form').send({ _csrf: csrf });
    await ajeno.reload();
    expect(ajeno.is_active).toBe(true);
  });

  test('pasar a PRO lleva a Stripe Checkout con el precio del servidor', async () => {
    const { agent } = await webLogin();
    const create = jest.spyOn(getStripe().checkout.sessions, 'create').mockResolvedValue({ id: 'cs_web', url: 'https://checkout.stripe.test/cs_web' });
    const csrf = csrfFrom((await agent.get('/cuenta')).text);
    const res = await agent.post('/cuenta/pro').type('form').send({ _csrf: csrf, plan_type: 'monthly' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('https://checkout.stripe.test/cs_web');
    const args = create.mock.calls[0][0];
    expect(args.line_items[0].price_data.unit_amount).toBe(700);
    expect(args.success_url).toBe('http://licencias.test/cuenta?pago=ok');
  });

  test('salir cierra la sesión', async () => {
    const { agent } = await webLogin();
    const csrf = csrfFrom((await agent.get('/cuenta')).text);
    await agent.post('/cuenta/salir').type('form').send({ _csrf: csrf });
    expect((await agent.get('/cuenta')).status).toBe(302);
  });
});
