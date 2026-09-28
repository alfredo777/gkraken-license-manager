// Suscripción mensual al plan de IA con Stripe (Checkout en modo suscripción).
// El webhook crea o renueva la AiSubscription; cada renovación (invoice.paid)
// reinicia los tokens del periodo.
const { Op } = require('sequelize');
const { AiSubscription, AiPlan, License } = require('../models');
const { getStripe } = require('./stripeClient');
const { CURRENCY } = require('../config/features');

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const toDate = (unix) => (unix ? new Date(unix * 1000) : null);

const activeSubscription = (licenseId) => AiSubscription.findOne({
  where: { license_id: licenseId, status: { [Op.in]: ['active', 'past_due'] }, period_end: { [Op.gt]: new Date() } },
  include: [{ model: AiPlan, as: 'plan' }], order: [['period_end', 'DESC']]
});

const createAiCheckout = (license, plan, { appUrl }) => getStripe().checkout.sessions.create({
  mode: 'subscription',
  customer: license.stripe_customer_id || undefined,
  customer_email: license.stripe_customer_id ? undefined : license.email,
  line_items: [{ quantity: 1, price_data: { currency: CURRENCY.toLowerCase(), unit_amount: Math.round(Number(plan.price_monthly) * 100), recurring: { interval: 'month' }, product_data: { name: `Green Kraken IA · ${plan.name}` } } }],
  metadata: { kind: 'ai_plan', license_id: String(license.id), plan_id: String(plan.id) },
  subscription_data: { metadata: { kind: 'ai_plan', license_id: String(license.id), plan_id: String(plan.id) } },
  success_url: `${appUrl}/cuenta?ia=ok#ia`,
  cancel_url: `${appUrl}/cuenta#ia`
});

// Crea o actualiza la suscripción local de una suscripción de Stripe.
const upsert = async ({ stripeId, licenseId, planId, periodStart, periodEnd, resetTokens, status }) => {
  const plan = await AiPlan.findByPk(planId);
  const license = await License.findByPk(licenseId);
  if (!plan || !license) return null;
  let sub = await AiSubscription.findOne({ where: { stripe_subscription_id: stripeId } });
  const start = periodStart || new Date();
  const end = periodEnd || new Date(start.getTime() + MONTH_MS);
  if (!sub) {
    // Cambio de plan: la suscripción anterior de la licencia se cancela en Stripe.
    const previous = await AiSubscription.findAll({ where: { license_id: licenseId, status: { [Op.ne]: 'canceled' } } });
    for (const old of previous) {
      if (old.stripe_subscription_id) { try { await getStripe().subscriptions.cancel(old.stripe_subscription_id); } catch (e) { console.error('No se pudo cancelar la suscripción anterior:', e.message); } }
      await old.update({ status: 'canceled' });
    }
    sub = await AiSubscription.create({ license_id: licenseId, plan_id: planId, stripe_subscription_id: stripeId, status: status || 'active', period_start: start, period_end: end, tokens_used: 0, tokens_limit: plan.monthly_tokens });
  } else {
    const update = { period_start: start, period_end: end, status: status || sub.status };
    if (resetTokens) Object.assign(update, { tokens_used: 0, tokens_limit: plan.monthly_tokens, plan_id: planId });
    await sub.update(update);
  }
  return sub;
};

const metaOf = (obj) => obj?.metadata?.kind === 'ai_plan' ? obj.metadata : null;
const invoiceSubscription = (inv) => inv.subscription || inv.parent?.subscription_details?.subscription || null;
const invoiceMeta = (inv) => metaOf(inv.subscription_details) || metaOf(inv.parent?.subscription_details) || metaOf(inv.lines?.data?.[0]);
const subscriptionPeriod = (s) => {
  const item = s.items?.data?.[0] || {};
  return { start: toDate(s.current_period_start || item.current_period_start), end: toDate(s.current_period_end || item.current_period_end) };
};
const mapStatus = (s) => (['active', 'trialing'].includes(s) ? 'active' : ['past_due', 'unpaid', 'incomplete'].includes(s) ? 'past_due' : 'canceled');

// Devuelve true si el evento era del plan de IA (y ya se aplicó).
const handleStripeEvent = async (event) => {
  const obj = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed': {
      const meta = metaOf(obj);
      if (obj.mode !== 'subscription' || !meta || !obj.subscription) return false;
      await upsert({ stripeId: obj.subscription, licenseId: Number(meta.license_id), planId: Number(meta.plan_id), resetTokens: false });
      if (obj.customer) await License.update({ stripe_customer_id: obj.customer }, { where: { id: Number(meta.license_id) } });
      return true;
    }
    case 'invoice.paid': {
      const stripeId = invoiceSubscription(obj);
      const meta = invoiceMeta(obj);
      if (!stripeId) return false;
      const existing = await AiSubscription.findOne({ where: { stripe_subscription_id: stripeId } });
      if (!existing && !meta) return false;
      const line = obj.lines?.data?.[0]?.period || {};
      await upsert({
        stripeId, licenseId: existing?.license_id || Number(meta.license_id), planId: meta ? Number(meta.plan_id) : existing.plan_id,
        periodStart: toDate(line.start), periodEnd: toDate(line.end), resetTokens: true, status: 'active'
      });
      return true;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = await AiSubscription.findOne({ where: { stripe_subscription_id: obj.id } });
      if (!sub) return Boolean(metaOf(obj));
      const period = subscriptionPeriod(obj);
      await sub.update({
        status: event.type === 'customer.subscription.deleted' ? 'canceled' : mapStatus(obj.status),
        cancel_at_period_end: Boolean(obj.cancel_at_period_end),
        ...(period.end ? { period_end: period.end } : {})
      });
      return true;
    }
    default:
      return false;
  }
};

const cancelAtPeriodEnd = async (sub) => {
  if (sub.stripe_subscription_id) await getStripe().subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true });
  await sub.update({ cancel_at_period_end: true });
};

module.exports = { activeSubscription, createAiCheckout, handleStripeEvent, cancelAtPeriodEnd };
