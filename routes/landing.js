const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.render('landing', { layout: 'main', title: `${process.env.APP_NAME} - Gestión de Licencias`, isLanding: true, priceAnnual: process.env.PRICE_ANNUAL || 49, priceMonthly: process.env.PRICE_MONTHLY || 7 });
});

module.exports = router;
