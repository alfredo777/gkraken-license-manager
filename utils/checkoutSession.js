// Sesión de Stripe Checkout para pasar una licencia a PRO. La usan la app
// (POST /api/v1/upgrade/checkout) y la cuenta web (/cuenta). El precio sale
// siempre del servidor; el webhook checkout.session.completed aplica el pago.
const { getStripe } = require('./stripeClient');
const { PRICES, CURRENCY } = require('../config/features');

const createCheckoutSession = (license, planType, { appUrl, successPath = '/payments/success', cancelPath }) => {
  const amount = PRICES[planType];
  return getStripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: license.stripe_customer_id ? undefined : license.email,
    customer: license.stripe_customer_id || undefined,
    line_items: [{ quantity: 1, price_data: { currency: CURRENCY.toLowerCase(), unit_amount: Math.round(amount * 100), product_data: { name: `Green Kraken PRO (${planType === 'annual' ? 'anual' : 'mensual'})` } } }],
    metadata: { license_id: String(license.id), plan_type: planType },
    payment_intent_data: { metadata: { license_id: String(license.id), plan_type: planType, source: 'checkout' } },
    success_url: `${appUrl}${successPath}`,
    cancel_url: `${appUrl}${cancelPath || `/payments/checkout?plan=${planType}`}`
  });
};

module.exports = { createCheckoutSession };
