const express = require('express');
const router = express.Router();
const { PRICES, CURRENCY } = require('../config/features');

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

module.exports = router;
