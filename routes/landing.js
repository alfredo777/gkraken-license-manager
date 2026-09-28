const express = require('express');
const router = express.Router();
const { PRICES, CURRENCY } = require('../config/features');
const { AiPlan, AiModel, AiProvider } = require('../models');

const fmtTokens = (n) => new Intl.NumberFormat('es-MX').format(Number(n) || 0);

// Enlaces de descarga de la app (vacío = "próximamente").
const downloads = () => [
  { os: 'Windows', icon: 'ri-windows-fill', note: 'Windows 10 o superior', url: process.env.DOWNLOAD_URL_WINDOWS },
  { os: 'macOS', icon: 'ri-apple-fill', note: 'macOS 13 o superior', url: process.env.DOWNLOAD_URL_MACOS },
  { os: 'Linux', icon: 'ri-ubuntu-fill', note: 'x11 / Wayland', url: process.env.DOWNLOAD_URL_LINUX }
];

router.get('/', (req, res) => {
  res.render('landing', {
    layout: 'site',
    title: 'Green Kraken — Flujos de trabajo con IA',
    metaDescription: 'Green Kraken: chat con 19 proveedores de IA, gestión de contexto y flujos de trabajo visuales en tu escritorio. Empieza gratis con tu cuenta de Google.',
    priceAnnual: PRICES.annual, priceMonthly: PRICES.monthly, currencyCode: CURRENCY,
    downloads: downloads()
  });
});

// Cómo funciona Green Kraken y sus dos formas de usar IA.
router.get('/como-funciona', async (req, res, next) => {
  try {
    const [plans, models] = await Promise.all([
      AiPlan.findAll({ where: { enabled: true }, order: [['sort_order', 'ASC'], ['price_monthly', 'ASC']] }),
      AiModel.findAll({ where: { enabled: true }, include: [{ model: AiProvider, as: 'provider', where: { enabled: true } }], order: [['provider_id', 'ASC'], ['display_name', 'ASC']] })
    ]);
    // Agrupados por proveedor para la tabla.
    const providers = [];
    for (const m of models) {
      let group = providers.find(p => p.name === m.provider.name);
      if (!group) { group = { name: m.provider.name, models: [] }; providers.push(group); }
      group.models.push({ name: m.display_name, factor: Number(m.token_factor) });
    }
    res.render('about', {
      layout: 'site',
      title: 'Cómo funciona · Green Kraken',
      metaDescription: 'Cómo funciona Green Kraken: usa Claude, Grok, ChatGPT, Gemini, DeepSeek o Qwen con tu propia clave o con el plan de IA de Green Kraken.',
      plans: plans.map(p => ({ ...p.toJSON(), tokensLabel: fmtTokens(p.monthly_tokens) })),
      providers, currencyCode: CURRENCY
    });
  } catch (error) { next(error); }
});

module.exports = router;
