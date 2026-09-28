const { request, app, models, api, device, resetDb, makeLicense } = require('./helpers');
const google = require('../utils/googleOAuth');
const { getStripe } = require('../utils/stripeClient');
const { hashToken } = require('../utils/aiTokens');

beforeEach(resetDb);
afterEach(() => jest.restoreAllMocks());
afterAll(() => models.sequelize.close());

const signed = (event) => {
  const payload = JSON.stringify({ id: `evt_${Math.random().toString(16).slice(2)}`, ...event });
  return request(app).post('/webhook/stripe').set('Content-Type', 'application/json')
    .set('Stripe-Signature', getStripe().webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET })).send(payload);
};
const makePlan = (over = {}) => models.AiPlan.create({ slug: 'basico', name: 'Básico', price_monthly: 12, monthly_tokens: 500000, ...over });

describe('Stripe: suscripción al plan de IA', () => {
  test('checkout completado crea la suscripción; invoice.paid renueva y reinicia tokens', async () => {
    const lic = await makeLicense();
    const plan = await makePlan();
    const meta = { kind: 'ai_plan', license_id: String(lic.id), plan_id: String(plan.id) };
    expect((await signed({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', mode: 'subscription', subscription: 'sub_1', customer: 'cus_1', payment_status: 'paid', metadata: meta } } })).status).toBe(200);
    let sub = await models.AiSubscription.findOne({ where: { stripe_subscription_id: 'sub_1' } });
    expect(sub).toMatchObject({ license_id: lic.id, status: 'active', tokens_limit: 500000 });
    expect(Number(sub.tokens_used)).toBe(0);
    await lic.reload();
    expect(lic.license_type).toBe('free');
    expect(lic.stripe_customer_id).toBe('cus_1');

    await sub.update({ tokens_used: 499000 });
    const start = Math.floor(Date.now() / 1000); const end = start + 30 * 86400;
    await signed({ type: 'invoice.paid', data: { object: { id: 'in_2', subscription: 'sub_1', lines: { data: [{ period: { start, end } }] } } } });
    sub = await sub.reload();
    expect(Number(sub.tokens_used)).toBe(0);
    expect(Math.round(new Date(sub.period_end).getTime() / 1000)).toBe(end);
  });

  test('invoice.paid antes del checkout crea la suscripción con los metadatos (API nueva)', async () => {
    const lic = await makeLicense(); const plan = await makePlan();
    await signed({ type: 'invoice.paid', data: { object: { id: 'in_1', parent: { subscription_details: { subscription: 'sub_9', metadata: { kind: 'ai_plan', license_id: String(lic.id), plan_id: String(plan.id) } } }, lines: { data: [{ period: { start: 1, end: Math.floor(Date.now() / 1000) + 86400 } }] } } } });
    expect(await models.AiSubscription.count({ where: { stripe_subscription_id: 'sub_9', status: 'active' } })).toBe(1);
  });

  test('el mismo evento dos veces no se aplica dos veces', async () => {
    const lic = await makeLicense(); const plan = await makePlan();
    const sub = await models.AiSubscription.create({ license_id: lic.id, plan_id: plan.id, stripe_subscription_id: 'sub_1', period_start: new Date(), period_end: new Date(Date.now() + 864e5), tokens_used: 100, tokens_limit: 500000 });
    const payload = JSON.stringify({ id: 'evt_fijo', type: 'invoice.paid', data: { object: { subscription: 'sub_1', lines: { data: [{ period: { start: 1, end: Math.floor(Date.now() / 1000) + 864e5 } }] } } } });
    const send = () => request(app).post('/webhook/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', getStripe().webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET })).send(payload);
    await send();
    await sub.update({ tokens_used: 777 });
    const again = await send();
    expect(again.body.duplicate).toBe(true);
    expect(Number((await sub.reload()).tokens_used)).toBe(777);
  });

  test('cancelación y pago vencido actualizan el estado', async () => {
    const lic = await makeLicense(); const plan = await makePlan();
    const sub = await models.AiSubscription.create({ license_id: lic.id, plan_id: plan.id, stripe_subscription_id: 'sub_1', period_start: new Date(), period_end: new Date(Date.now() + 864e5), tokens_limit: 1 });
    await signed({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'past_due', cancel_at_period_end: true } } });
    expect((await sub.reload())).toMatchObject({ status: 'past_due', cancel_at_period_end: true });
    await signed({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', status: 'canceled' } } });
    expect((await sub.reload()).status).toBe('canceled');
  });

  test('cambiar de plan cancela la suscripción anterior en Stripe', async () => {
    const lic = await makeLicense(); const plan = await makePlan(); const pro = await makePlan({ slug: 'pro', name: 'Pro', monthly_tokens: 2000000 });
    await models.AiSubscription.create({ license_id: lic.id, plan_id: plan.id, stripe_subscription_id: 'sub_old', period_start: new Date(), period_end: new Date(Date.now() + 864e5), tokens_limit: 1 });
    const cancel = jest.spyOn(getStripe().subscriptions, 'cancel').mockResolvedValue({});
    await signed({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_new', metadata: { kind: 'ai_plan', license_id: String(lic.id), plan_id: String(pro.id) } } } });
    expect(cancel).toHaveBeenCalledWith('sub_old');
    expect((await models.AiSubscription.findOne({ where: { stripe_subscription_id: 'sub_old' } })).status).toBe('canceled');
    expect(Number((await models.AiSubscription.findOne({ where: { stripe_subscription_id: 'sub_new' } })).tokens_limit)).toBe(2000000);
  });
});

describe('token de IA al iniciar sesión en la app', () => {
  const appLogin = async (dev) => {
    jest.spyOn(google, 'exchangeCode').mockResolvedValue({ sub: 'g-1', email: 'ana@example.com', email_verified: true, name: 'Ana' });
    const start = await api.post('/auth/google/start').send(dev);
    const state = start.body.auth_url.split('/').pop();
    await request(app).get(`/auth/google/callback?state=${state}&code=x`);
    return api.get(`/auth/google/status/${start.body.session_id}`).set('X-Poll-Token', start.body.poll_token);
  };

  test('se entrega una vez, solo su hash queda guardado, y no queda en la sesión', async () => {
    const res = await appLogin(device('pc-1'));
    expect(res.body.ai_token).toMatch(/^gkai_/);
    const row = await models.AiToken.findOne();
    expect(row).toMatchObject({ device_id: 'pc-1', token_hash: hashToken(res.body.ai_token), revoked_at: null });
    const sessions = await models.AuthSession.findAll({ raw: true });
    expect(JSON.stringify(sessions)).not.toContain(res.body.ai_token);
  });

  test('un nuevo login del mismo equipo revoca el token anterior', async () => {
    await appLogin(device('pc-1'));
    await appLogin(device('pc-1'));
    expect(await models.AiToken.count({ where: { revoked_at: null } })).toBe(1);
  });

  test('migrar la licencia revoca el token del equipo que sale', async () => {
    const first = await appLogin(device('pc-1'));
    const moved = await (async () => {
      jest.restoreAllMocks();
      jest.spyOn(google, 'exchangeCode').mockResolvedValue({ sub: 'g-1', email: 'ana@example.com', email_verified: true, name: 'Ana' });
      const start = await api.post('/auth/google/start').send({ ...device('pc-2'), mode: 'migrate' });
      const state = start.body.auth_url.split('/').pop();
      await request(app).get(`/auth/google/callback?state=${state}&code=x`);
      return api.get(`/auth/google/status/${start.body.session_id}`).set('X-Poll-Token', start.body.poll_token);
    })();
    expect(moved.body.ai_token).toMatch(/^gkai_/);
    const old = await models.AiToken.findOne({ where: { token_hash: hashToken(first.body.ai_token) } });
    expect(old.revoked_at).not.toBeNull();
  });
});

describe('Mi cuenta: plan de IA', () => {
  const webLogin = async () => {
    jest.spyOn(google, 'exchangeCode').mockResolvedValue({ sub: 'g-web', email: 'luis@example.com', email_verified: true, name: 'Luis' });
    const agent = request.agent(app);
    const go = await agent.get('/cuenta/entrar?go=1');
    await agent.get(`/auth/google/callback?state=${new URL(go.headers.location).searchParams.get('state')}&code=x`);
    return agent;
  };
  const csrfFrom = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];

  test('sin plan: muestra los planes y suscribirse lleva a Stripe en modo suscripción', async () => {
    const plan = await makePlan({ description: 'Para empezar' });
    const agent = await webLogin();
    const page = await agent.get('/cuenta');
    expect(page.text).toContain('IA de Green Kraken');
    expect(page.text).toContain('500,000 tokens al mes');
    const create = jest.spyOn(getStripe().checkout.sessions, 'create').mockResolvedValue({ id: 'cs', url: 'https://checkout.stripe.test/sub' });
    const res = await agent.post('/cuenta/ia/suscribir').type('form').send({ _csrf: csrfFrom(page.text), plan_id: plan.id });
    expect(res.status).toBe(303);
    const args = create.mock.calls[0][0];
    expect(args.mode).toBe('subscription');
    expect(args.line_items[0].price_data).toMatchObject({ unit_amount: 1200, recurring: { interval: 'month' } });
    expect(args.subscription_data.metadata.plan_id).toBe(String(plan.id));
  });

  test('con plan: muestra el consumo y permite desconectar un equipo y cancelar', async () => {
    const plan = await makePlan();
    const agent = await webLogin();
    const lic = await models.License.findOne({ where: { google_sub: 'g-web' } });
    const sub = await models.AiSubscription.create({ license_id: lic.id, plan_id: plan.id, stripe_subscription_id: 'sub_1', period_start: new Date(), period_end: new Date(Date.now() + 864e5), tokens_used: 125000, tokens_limit: 500000 });
    const tok = await models.AiToken.create({ license_id: lic.id, device_id: 'pc-1', device_name: 'Laptop', token_hash: 'h'.repeat(64), prefix: 'gkai_abc' });
    const page = await agent.get('/cuenta');
    expect(page.text).toContain('125,000 de 500,000 tokens');
    expect(page.text).toContain('width:25%');
    const csrf = csrfFrom(page.text);
    await agent.post(`/cuenta/ia/tokens/${tok.id}/revocar`).type('form').send({ _csrf: csrf });
    expect((await tok.reload()).revoked_at).not.toBeNull();
    const update = jest.spyOn(getStripe().subscriptions, 'update').mockResolvedValue({});
    await agent.post('/cuenta/ia/cancelar').type('form').send({ _csrf: csrf });
    expect(update).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: true });
    expect((await sub.reload()).cancel_at_period_end).toBe(true);
  });
});

describe('panel de administración de IA', () => {
  const adminAgent = async (role = 'superadmin') => {
    const bcrypt = require('bcryptjs');
    await models.Admin.create({ username: 'root', email: 'root@x.com', phone: '+1', password_hash: await bcrypt.hash('clave-larga-segura', 4), is_active: true, role });
    const agent = request.agent(app);
    await agent.post('/admin/login').type('form').send({ username: 'root', password: 'clave-larga-segura' });
    return agent;
  };

  test('guardar un proveedor cifra la clave y el panel solo muestra los últimos 4', async () => {
    const agent = await adminAgent();
    await agent.post('/dashboard/ai/providers').type('form').send({ name: 'xAI', slug: 'xai', api_format: 'openai', base_url: 'https://api.x.ai/v1', api_key: 'xai-SECRETO-9876', enabled: 'on' });
    const p = await models.AiProvider.findOne({ where: { slug: 'xai' }, raw: true });
    expect(p.key_last4).toBe('9876');
    expect(JSON.stringify(p)).not.toContain('SECRETO');
    const page = await agent.get('/dashboard/ai');
    expect(page.status).toBe(200);
    expect(page.text).not.toContain('SECRETO');
    expect(page.text).toContain('9876');
  });

  test('crear modelo y plan', async () => {
    const agent = await adminAgent();
    const p = await models.AiProvider.create({ slug: 'anthropic', name: 'Anthropic', api_format: 'anthropic', base_url: 'https://api.anthropic.com' });
    await agent.post('/dashboard/ai/models').type('form').send({ provider_id: p.id, model_id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', cost_input_per_mtok: '4', cost_output_per_mtok: '20', token_factor: '4', max_output_tokens: '32000', enabled: 'on' });
    const m = await models.AiModel.findOne();
    expect(Number(m.token_factor)).toBe(4);
    await agent.post('/dashboard/ai/plans').type('form').send({ name: 'Pro', slug: 'pro', price_monthly: '25', monthly_tokens: '3000000', allowed_models: `${m.id}`, rpm: '60', max_concurrent: '4', enabled: 'on' });
    expect((await models.AiPlan.findOne()).allowed_models).toBe(JSON.stringify([m.id]));
  });

  test('un admin que no es superadmin no puede tocar claves', async () => {
    const agent = await adminAgent('support');
    await agent.post('/dashboard/ai/providers').type('form').send({ name: 'x', slug: 'x', api_format: 'openai', base_url: 'https://x.test', api_key: 'k' });
    expect(await models.AiProvider.count()).toBe(0);
  });
});

test('/como-funciona explica las dos formas y lista modelos y planes activos', async () => {
  const p = await models.AiProvider.create({ slug: 'anthropic', name: 'Anthropic (Claude)', api_format: 'anthropic', base_url: 'https://api.anthropic.com', enabled: true });
  await models.AiModel.create({ provider_id: p.id, model_id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', token_factor: 4 });
  await models.AiModel.create({ provider_id: p.id, model_id: 'oculto', display_name: 'Modelo apagado', enabled: false });
  await makePlan();
  const res = await request(app).get('/como-funciona');
  expect(res.status).toBe(200);
  expect(res.text).toContain('Con tu propia clave');
  expect(res.text).toContain('Con el plan de IA de Green Kraken');
  expect(res.text).toContain('Claude Opus 5.5');
  expect(res.text).toContain('×4');
  expect(res.text).not.toContain('Modelo apagado');
  expect(res.text).toContain('500,000 tokens al mes');
});
