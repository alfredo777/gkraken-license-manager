// Cliente de Stripe compartido y perezoso: no falla al cargar el módulo cuando
// STRIPE_SECRET_KEY no está configurada (desarrollo, pruebas).
let client = null;

const getStripe = () => {
  if (!client) client = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_not_configured');
  return client;
};

module.exports = { getStripe };
