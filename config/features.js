// Catálogo de features y precios que ve la app cliente (Green Kraken).
// Si una licencia no tiene `features` propias, se usan las de su tipo.
// advanced_features quita el límite de 3 flujos de trabajo de la versión gratuita en la app.

const FEATURES = {
  free: ['basic_features', 'limited_exports'],
  pro: ['basic_features', 'advanced_features', 'unlimited_exports', 'priority_support']
};

const PRICES = {
  annual: parseFloat(process.env.PRICE_ANNUAL) || 49,
  monthly: parseFloat(process.env.PRICE_MONTHLY) || 7
};

const CURRENCY = (process.env.CURRENCY || 'USD').toUpperCase();

const featuresFor = (license) => {
  if (license && license.features) {
    try {
      const parsed = typeof license.features === 'string' ? JSON.parse(license.features) : license.features;
      if (Array.isArray(parsed)) return parsed;
    } catch (_) { /* valor corrupto: se usan las del tipo */ }
  }
  return FEATURES[license?.license_type] || FEATURES.free;
};

module.exports = { FEATURES, PRICES, CURRENCY, featuresFor };
