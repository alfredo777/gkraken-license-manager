const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal = require('paypal-rest-sdk');
const { License, Payment, AccessNode } = require('../models');
const { getClientIp, getGeoData } = require('../middleware/ipTracker');
const { generateLicenseKey } = require('../utils/codeGenerator');
const { generateEncryptionKey, generateCertificate } = require('../utils/encryption');
const { sendPaymentConfirmation, sendLicenseInfo } = require('../utils/mailer');

paypal.configure({ mode: process.env.PAYPAL_MODE || 'sandbox', client_id: process.env.PAYPAL_CLIENT_ID, client_secret: process.env.PAYPAL_CLIENT_SECRET });

const PRICES = { annual: parseFloat(process.env.PRICE_ANNUAL) || 49, monthly: parseFloat(process.env.PRICE_MONTHLY) || 7 };

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
    const amount = PRICES[plan_type] || PRICES.annual;
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
    const amount = PRICES[plan_type] || PRICES.annual;
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
  try { event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET); } catch (err) { return res.status(400).send(`Webhook Error: ${err.message}`); }
  try {
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      const { plan_type, license_id } = pi.metadata;
      const amount = pi.amount / 100;
      if (license_id) {
        const license = await License.findByPk(license_id);
        if (license) {
          const start = new Date(); let end = new Date();
          if (plan_type === 'annual') end.setFullYear(end.getFullYear() + 1); else end.setMonth(end.getMonth() + 1);
          const encKey = generateEncryptionKey(); const certData = generateCertificate(license.name, license.email);
          await license.update({ license_key: license.license_type === 'free' ? generateLicenseKey('pro') : license.license_key, license_type: 'pro', plan_type, status: 'active', start_date: start, end_date: end, auto_renew: true, stripe_customer_id: pi.customer, encryption_key: encKey, encryption_certificate: certData.certificate });
          await Payment.create({ license_id: license.id, amount, currency: 'USD', method: 'stripe', plan_type: plan_type || 'annual', transaction_id: pi.id, status: 'completed', payment_details: JSON.stringify({ stripe_customer: pi.customer }), paid_at: new Date() });
          await sendPaymentConfirmation(license.email, license.name, amount, plan_type);
          await sendLicenseInfo(license.email, license.toJSON());
        }
      }
    }
  } catch (error) { console.error('Webhook error:', error); }
  res.json({ received: true });
};

exports.paypalCreateOrder = async (req, res) => {
  try {
    const { plan_type, license_id } = req.body;
    const amount = PRICES[plan_type] || PRICES.annual;
    const json = { intent: 'sale', payer: { payment_method: 'paypal' }, redirect_urls: { return_url: `${process.env.APP_URL}/payments/paypal/success?plan_type=${plan_type}&license_id=${license_id || ''}`, cancel_url: `${process.env.APP_URL}/payments/paypal/cancel` }, transactions: [{ item_list: { items: [{ name: `Licencia PRO - ${plan_type}`, sku: `LICENSE-PRO-${plan_type.toUpperCase()}`, price: amount.toFixed(2), currency: 'USD', quantity: 1 }] }, amount: { currency: 'USD', total: amount.toFixed(2) }, description: `Licencia PRO ${plan_type}` }] };
    paypal.payment.create(json, (error, payment) => {
      if (error) return res.status(500).json({ success: false, error: 'Error PayPal.' });
      const url = payment.links.find(l => l.rel === 'approval_url');
      return res.json({ success: true, approval_url: url.href, payment_id: payment.id });
    });
  } catch (error) { return res.status(500).json({ success: false, error: error.message }); }
};

exports.paypalSuccess = async (req, res) => {
  try {
    const { paymentId, PayerID, plan_type, license_id } = req.query;
    paypal.payment.execute(paymentId, { payer_id: PayerID }, async (error, payment) => {
      if (error) { req.flash('error_msg', 'Error PayPal.'); return res.redirect('/payments/checkout'); }
      const amount = parseFloat(payment.transactions[0].amount.total);
      const ip = getClientIp(req); const geo = getGeoData(ip);
      if (license_id) {
        const license = await License.findByPk(license_id);
        if (license) {
          const start = new Date(); let end = new Date();
          if (plan_type === 'annual') end.setFullYear(end.getFullYear() + 1); else end.setMonth(end.getMonth() + 1);
          const encKey = generateEncryptionKey(); const certData = generateCertificate(license.name, license.email);
          await license.update({ license_key: license.license_type === 'free' ? generateLicenseKey('pro') : license.license_key, license_type: 'pro', plan_type: plan_type || 'annual', status: 'active', start_date: start, end_date: end, paypal_subscription_id: paymentId, encryption_key: encKey, encryption_certificate: certData.certificate });
          await Payment.create({ license_id: license.id, amount, currency: 'USD', method: 'paypal', plan_type: plan_type || 'annual', transaction_id: paymentId, status: 'completed', payment_details: JSON.stringify(payment), ip_address: ip, paid_at: new Date() });
          await AccessNode.create({ license_id: license.id, ip_address: ip, country: geo.country, region: geo.region, city: geo.city, action: 'payment', user_agent: req.headers['user-agent'], response_status: true, accessed_at: new Date() });
          await sendPaymentConfirmation(license.email, license.name, amount, plan_type);
        }
      }
      req.flash('success_msg', 'Pago exitoso.');
      return res.redirect('/payments/success');
    });
  } catch (error) { req.flash('error_msg', 'Error.'); return res.redirect('/payments/checkout'); }
};

exports.paypalCancel = (req, res) => { req.flash('error_msg', 'Pago cancelado.'); return res.redirect('/payments/checkout'); };

exports.bitcoinCreateCharge = async (req, res) => {
  try {
    const { plan_type, license_id, email, name } = req.body;
    const amount = PRICES[plan_type] || PRICES.annual;
    const CoinbaseCommerce = require('coinbase-commerce-node');
    CoinbaseCommerce.Client.init(process.env.COINBASE_COMMERCE_API_KEY);
    const charge = await CoinbaseCommerce.resources.Charge.create({ name: `Licencia PRO - ${plan_type}`, description: `Licencia PRO ${plan_type}`, local_price: { amount: amount.toFixed(2), currency: 'USD' }, pricing_type: 'fixed_price', metadata: { plan_type, license_id: license_id || '', email: email || '' }, redirect_url: `${process.env.APP_URL}/payments/bitcoin/success?license_id=${license_id || ''}&plan_type=${plan_type}`, cancel_url: `${process.env.APP_URL}/payments/bitcoin/cancel` });
    return res.json({ success: true, hosted_url: charge.hosted_url, charge_id: charge.id });
  } catch (error) { return res.status(500).json({ success: false, error: error.message }); }
};

exports.bitcoinWebhook = async (req, res) => {
  try {
    const CoinbaseCommerce = require('coinbase-commerce-node');
    const event = CoinbaseCommerce.Webhook.verifyEventBody(JSON.stringify(req.body), req.headers['x-cc-webhook-signature'], process.env.COINBASE_COMMERCE_WEBHOOK_SECRET);
    if (event.type === 'charge:confirmed') {
      const { plan_type, license_id } = event.data.metadata;
      const amount = parseFloat(event.data.pricing.local.amount);
      if (license_id) {
        const license = await License.findByPk(license_id);
        if (license) {
          const start = new Date(); let end = new Date();
          if (plan_type === 'annual') end.setFullYear(end.getFullYear() + 1); else end.setMonth(end.getMonth() + 1);
          const encKey = generateEncryptionKey(); const certData = generateCertificate(license.name, license.email);
          await license.update({ license_key: license.license_type === 'free' ? generateLicenseKey('pro') : license.license_key, license_type: 'pro', plan_type, status: 'active', start_date: start, end_date: end, encryption_key: encKey, encryption_certificate: certData.certificate });
          await Payment.create({ license_id: license.id, amount, currency: 'USD', method: 'bitcoin', plan_type, transaction_id: event.data.id, status: 'completed', payment_details: JSON.stringify(event.data), paid_at: new Date() });
          await sendPaymentConfirmation(license.email, license.name, amount, plan_type);
        }
      }
    }
    return res.json({ received: true });
  } catch (error) { return res.status(400).json({ error: error.message }); }
};

exports.bitcoinSuccess = (req, res) => { req.flash('success_msg', 'Bitcoin procesado. Se activará al confirmar.'); res.redirect('/payments/success'); };
exports.bitcoinCancel = (req, res) => { req.flash('error_msg', 'Bitcoin cancelado.'); res.redirect('/payments/checkout'); };

exports.paymentHistory = async (req, res) => {
  try {
    const payments = await Payment.findAll({ include: [{ model: License, as: 'license', attributes: ['license_key', 'name', 'email'] }], order: [['created_at', 'DESC']] });
    res.render('payments/index', { layout: 'main', title: 'Pagos', payments: payments.map(p => p.toJSON()), totalRevenue: payments.filter(p => p.status === 'completed').reduce((sum, p) => sum + parseFloat(p.amount), 0) });
  } catch (error) { req.flash('error_msg', 'Error.'); res.redirect('/dashboard'); }
};

exports.successPage = (req, res) => { res.render('payments/success', { layout: 'main', title: 'Pago Exitoso' }); };

exports.manualPayment = async (req, res) => {
  try {
    const { license_id, amount, plan_type, notes } = req.body;
    const ip = getClientIp(req);
    const license = await License.findByPk(license_id);
    if (!license) { req.flash('error_msg', 'No encontrada.'); return res.redirect('/dashboard/licenses'); }
    const start = new Date(); let end = new Date();
    if (plan_type === 'annual') end.setFullYear(end.getFullYear() + 1); else end.setMonth(end.getMonth() + 1);
    const encKey = generateEncryptionKey(); const certData = generateCertificate(license.name, license.email);
    await license.update({ license_key: license.license_type === 'free' ? generateLicenseKey('pro') : license.license_key, license_type: 'pro', plan_type, status: 'active', start_date: start, end_date: end, encryption_key: encKey, encryption_certificate: certData.certificate });
    await Payment.create({ license_id: license.id, amount: amount || PRICES[plan_type], currency: 'USD', method: 'manual', plan_type, transaction_id: `MANUAL-${Date.now()}`, status: 'completed', payment_details: JSON.stringify({ notes, admin: req.session.admin?.username }), ip_address: ip, paid_at: new Date() });
    await sendPaymentConfirmation(license.email, license.name, amount || PRICES[plan_type], plan_type);
    await sendLicenseInfo(license.email, license.toJSON());
    req.flash('success_msg', 'Pago manual registrado.');
    return res.redirect(`/dashboard/licenses/${license.id}`);
  } catch (error) { req.flash('error_msg', 'Error: ' + error.message); return res.redirect('/dashboard/licenses'); }
};
