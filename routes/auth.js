// Páginas del login con Google que abre el navegador del usuario.
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const googleCtrl = require('../controllers/googleAuthController');

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

router.get('/google/start/:state', limiter, googleCtrl.redirect);
router.get('/google/callback', limiter, googleCtrl.callback);

module.exports = router;
