const paypal = require('paypal-rest-sdk');
const { License, Payment, AccessNode, ProcessedEvent } = require('../models');
const aiBilling = require('../utils/aiBilling');
const { getClientIp, getGeoData } = require('../middleware/ipTracker');
const { getStripe } = require('../utils/stripeClient');
const { applyUpgrade, findLicense, PLAN_TYPES } = require('../utils/applyUpgrade');
const { PRICES } = require('../config/features');

paypal.configure({ mode: process.env.PAYPAL_MODE || 'sandbox', client_id: process.env.PAYPAL_CLIENT_ID, client_secret: process.env.PAYPAL_CLIENT_SECRET });

const stripe = new Proxy({}, { get: (_, prop) => getStripe()[prop] });
const validPlan = (plan) => PLAN_TYPES.includes(plan);
const badPlan = (res) => res.status(400).json({ success: false, error: 'plan_type debe ser monthly o annual.' });

exports.checkoutPage = async (req, res) => {
  const { plan } = req.query;
  const licenseId = req.query.license_id;
  let license = null;
  if (licenseId) license = await License.findByPk(licenseId);
  res.render('payments/checkout', { layout: 'main', title: 'Pagar Licencia PRO', plan: plan || 'annual', price: PRICES[plan] || PRICES.annual, priceMonthly: PRICES.monthly, priceAnnual: PRICES.annual, license: license ? license.toJSON() : null, stripeKey: process.env.STRIPE_PUBLISHABLE_KEY, paypalClientId: process.env.PAYPAL_CLIENT_ID });
};

exports.stripeCreateIntent = async (req, res) => {
  try {
    const { plan_type, license_id, email, name } = req.body;
    if (!validPlan(plan_type)) return badPlan(res);
    const amount = PRICES[plan_type];
    let customerId;
    if (license_id) { const lic = await License.findByPk(license_id); if (lic?.stripe_customer_id) customerId = lic.stripe_customer_id; }
    if (!customerId) { const customer = await stripe.customers.create({ email, name, metadata: { license_id: license_id || '' } }); customerId = customer.id; }
    const paymentIntent = await stripe.paymentIntents.create({ amount: Math.round(amount * 100), currency: 'usd', customer: customerId, metadata: { plan_type, license_id: license_id || '', email: email || '' }, automatic_payment_methods: { enabled: true } });
    return res.json({ success: true, clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id });
  } catch (error) { console.error('Stripe error:', error); return res.status(500).json({ success: false, error: error.message }); }
};

exports.stripeCreateSubscription = async (req, res) => {
  try {
    const { plan_type, license_id, email, name, payment_method_id } = req.body;
    if (!validPlan(plan_type)) return badPlan(res);
    const amount = PRICES[plan_type];
    const interval = plan_type === 'monthly' ? 'month' : 'year';
    let customer;
    if (license_id) { const lic = await License.findByPk(license_id); if (lic?.stripe_customer_id) customer = await stripe.customers.retrieve(lic.stripe_customer_id); }
    if (!customer) { customer = await stripe.customers.create({ email, name, payment_method: payment_method_id, invoice_settings: { default_payment_method: payment_method_id } }); }
    const price = await stripe.prices.create({ unit_amount: Math.round(amount * 100), currency: 'usd', recurring: { interval }, product_data: { name: `Licencia PRO - ${plan_type}` } });
    const subscription = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: price.id }], payment_behavior: 'default_incomplete', expand: ['latest_invoice.payment_intent'], metadata: { license_id: license_id || '', plan_type } });
    return res.json({ success: true, subscriptionId: subscription.id, clientSecret: subscription.latest_invoice.payment_intent.client_secret, customerId: customer.id });
  } catch (error) { console.error('Stripe sub error:', error); return res.status(500).json({ success: false, error: error.message }); }
};

exports.stripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try { event = getStripe().webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET); } catch (err) { return res.status(400).send('Webhook Error: firma inválida.'); }
  // Cada evento se aplica una sola vez aunque Stripe lo reenvíe.
  const [, isNew] = await ProcessedEvent.findOrCreate({ where: { event_id: event.id }, defaults: { source: 'stripe' } });
  if (!isNew) return res.json({ received: true, duplicate: true });
  try {
    if (await aiBilling.handleStripeEvent(event)) return res.json({ received: true });
    const obj = event.data.object;
    // Checkout Session (flujo de la app) o PaymentIntent (checkout web). Los
    // PaymentIntent creados por una Checkout Session se ignoran para no duplicar.
    const handled = event.type === 'checkout.session.completed' ? (obj.mode !== 'subscription' && obj.payment_status === 'paid')
      : event.type === 'payment_intent.succeeded' ? obj.metadata?.source !== 'checkout' : false;
    if (handled) {
      const { plan_type, license_id } = obj.metadata || {};
      const license = await findLicense(license_id);
      if (license && validPlan(plan_type)) {
        const amount = (event.type === 'checkout.session.completed' ? obj.amount_total : obj.amount) / 100;
        await applyUpgrade(license, {
          plan_type,
          payment: { method: 'stripe', amount, currency: (obj.currency || 'usd').toUpperCase(), transaction_id: obj.payment_intent || obj.id, details: { stripe_customer: obj.customer, event: event.type } },
          extra: { stripe_customer_id: obj.customer || license.stripe_customer_id }
        });
      }
    }
  } catch (error) {
    console.error('Webhook error:', error.message);
    await ProcessedEvent.destroy({ where: { event_id: event.id } });
    return res.status(500).json({ received: false });
  }
  res.json({ received: true });
};

exports.paypalCreateOrder = async (req, res) => {
  try {
    const { plan_type, license_id } = req.body;
    if (!validPlan(plan_type)) return badPlan(res);
    const amount = PRICES[plan_type];
    // license_id y plan_type viajan en `custom` y se leen del pago ejecutado,
    // nunca de la URL de retorno (que el usuario puede modificar).
    const json = { intent: 'sale', payer: { payment_method: 'paypal' }, redirect_urls: { return_url: `${process.env.APP_URL}/payments/paypal/success`, cancel_url: `${process.env.APP_URL}/payments/paypal/cancel` }, transactions: [{ custom: JSON.stringify({ license_id: license_id || '', plan_type }), item_list: { items: [{ name: `Licencia PRO - ${plan_type}`, sku: `LICENSE-PRO-${plan_type.toUpperCase()}`, price: amount.toFixed(2), currency: 'USD', quantity: 1 }] }, amount: { currency: 'USD', total: amount.toFixed(2) }, description: `Licencia PRO ${plan_type}` }] };
    paypal.payment.create(json, (error, payment) => {
      if (error) return res.status(500).json({ success: false, error: 'Error PayPal.' });
      const url = payment.links.find(l => l.rel === 'approval_url');
      return res.json({ success: true, approval_url: url.href, payment_id: payment.id });
    });
  } catch (error) { return res.status(500).json({ success: false, error: error.message }); }
};

exports.paypalSuccess = async (req, res) => {
  const { paymentId, PayerID } = req.query;
  if (!paymentId || !PayerID) { req.flash('error_msg', 'Pago PayPal inválido.'); return res.redirect('/payments/checkout'); }
  if (await Payment.findOne({ where: { transaction_id: String(paymentId) } })) { req.flash('error_msg', 'Este pago ya fue procesado.'); return res.redirect('/payments/checkout'); }
  paypal.payment.execute(paymentId, { payer_id: PayerID }, async (error, payment) => {
    try {
      if (error || payment.state !== 'approved') { req.flash('error_msg', 'Error PayPal.'); return res.redirect('/payments/checkout'); }
      const tx = payment.transactions[0];
      let meta = {};
      try { meta = JSON.parse(tx.custom || '{}'); } catch (_) { meta = {}; }
      const amount = parseFloat(tx.amount.total);
      const license = await findLicense(meta.license_id);
      if (license && validPlan(meta.plan_type) && amount >= PRICES[meta.plan_type] && tx.amount.currency === 'USD') {
        const ip = getClientIp(req); const geo = getGeoData(ip);
        const r = await applyUpgrade(license, { plan_type: meta.plan_type, payment: { method: 'paypal', amount, transaction_id: String(paymentId), details: { payer: payment.payer?.payer_info?.email, state: payment.state }, ip }, extra: { paypal_subscription_id: String(paymentId) } });
        if (r.applied) await AccessNode.create({ license_id: license.id, ip_address: ip, country: geo.country, region: geo.region, city: geo.city, action: 'payment', user_agent: req.headers['user-agent'], response_status: true, accessed_at: new Date() });
        req.flash('success_msg', 'Pago exitoso.');
        return res.redirect('/payments/success');
      }
      console.error('PayPal: pago sin licencia válida o monto incorrecto', paymentId);
      req.flash('error_msg', 'Recibimos tu pago pero no pudimos aplicarlo a una licencia. Escríbenos a soporte con tu comprobante.');
      return res.redirect('/payments/checkout');
    } catch (e) { console.error('PayPal success error:', e.message); req.flash('error_msg', 'Error.'); return res.redirect('/payments/checkout'); }
  });
};

exports.paypalCancel = (req, res) => { req.flash('error_msg', 'Pago cancelado.'); return res.redirect('/payments/checkout'); };

exports.bitcoinCreateCharge = async (req, res) => {
  try {
    const { plan_type, license_id, email, name } = req.body;
    if (!validPlan(plan_type)) return badPlan(res);
    const amount = PRICES[plan_type];
    const CoinbaseCommerce = require('coinbase-commerce-node');
    CoinbaseCommerce.Client.init(process.env.COINBASE_COMMERCE_API_KEY);
    const charge = await CoinbaseCommerce.resources.Charge.create({ name: `Licencia PRO - ${plan_type}`, description: `Licencia PRO ${plan_type}`, local_price: { amount: amount.toFixed(2), currency: 'USD' }, pricing_type: 'fixed_price', metadata: { plan_type, license_id: license_id || '', email: email || '' }, redirect_url: `${process.env.APP_URL}/payments/bitcoin/success?license_id=${license_id || ''}&plan_type=${plan_type}`, cancel_url: `${process.env.APP_URL}/payments/bitcoin/cancel` });
    return res.json({ success: true, hosted_url: charge.hosted_url, charge_id: charge.id });
  } catch (error) { return res.status(500).json({ success: false, error: error.message }); }
};

exports.bitcoinWebhook = async (req, res) => {
  let event;
  try {
    const CoinbaseCommerce = require('coinbase-commerce-node');
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    event = CoinbaseCommerce.Webhook.verifyEventBody(raw, req.headers['x-cc-webhook-signature'], process.env.COINBASE_COMMERCE_WEBHOOK_SECRET);
  } catch (error) { return res.status(400).json({ error: 'Firma inválida.' }); }
  try {
    if (event.type === 'charge:confirmed') {
      const { plan_type, license_id } = event.data.metadata || {};
      const amount = parseFloat(event.data.pricing.local.amount);
      const license = await findLicense(license_id);
      if (license && validPlan(plan_type) && amount >= PRICES[plan_type]) {
        await applyUpgrade(license, { plan_type, payment: { method: 'bitcoin', amount, transaction_id: event.data.id, details: { code: event.data.code } } });
      }
    }
    return res.json({ received: true });
  } catch (error) { console.error('Bitcoin webhook error:', error.message); return res.status(500).json({ received: false }); }
};

exports.bitcoinSuccess = (req, res) => { req.flash('success_msg', 'Bitcoin procesado. Se activará al confirmar.'); res.redirect('/payments/success'); };
exports.bitcoinCancel = (req, res) => { req.flash('error_msg', 'Bitcoin cancelado.'); res.redirect('/payments/checkout'); };

exports.paymentHistory = async (req, res) => {
  try {
    const payments = await Payment.findAll({ include: [{ model: License, as: 'license', attributes: ['license_key', 'name', 'email'] }], order: [['created_at', 'DESC']] });
    res.render('payments/index', { layout: 'main', title: 'Pagos', payments: payments.map(p => p.toJSON()), totalRevenue: payments.filter(p => p.status === 'completed').reduce((sum, p) => sum + parseFloat(p.amount), 0) });
  } catch (error) { req.flash('error_msg', 'Error.'); res.redirect('/dashboard'); }
};

exports.successPage = (req, res) => { res.render('payments/success', { layout: 'site', title: 'Pago recibido · Green Kraken' }); };

exports.manualPayment = async (req, res) => {
  const isApi = req.originalUrl.startsWith('/api');
  try {
    const { license_id, amount, plan_type, notes } = req.body;
    const license = await findLicense(license_id);
    if (!license || !validPlan(plan_type)) {
      if (isApi) return res.status(400).json({ success: false, error: 'Licencia o plan_type inválido.' });
      req.flash('error_msg', 'Licencia o plan inválido.'); return res.redirect('/dashboard/licenses');
    }
    const admin = req.session?.admin?.username || req.admin?.username;
    await applyUpgrade(license, { plan_type, payment: { method: 'manual', amount: parseFloat(amount) || PRICES[plan_type], transaction_id: `MANUAL-${Date.now()}`, details: { notes, admin }, ip: getClientIp(req) } });
    if (isApi) return res.json({ success: true, license: license.toJSON() });
    req.flash('success_msg', 'Pago manual registrado.');
    return res.redirect(`/dashboard/licenses/${license.id}`);
  } catch (error) {
    if (isApi) return res.status(500).json({ success: false, error: error.message });
    req.flash('error_msg', 'Error: ' + error.message); return res.redirect('/dashboard/licenses');
  }
};
