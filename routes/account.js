// Cuenta web de los usuarios de Green Kraken.
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const ctrl = require('../controllers/accountController');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === 'test' });

router.use(ctrl.csrf);
router.get('/entrar', loginLimiter, wrap(ctrl.loginPage));
router.get('/', ctrl.requireCustomer, wrap(ctrl.index));
router.post('/dispositivos/:id/desvincular', ctrl.requireCustomer, wrap(ctrl.unlinkDevice));
router.post('/pro', ctrl.requireCustomer, wrap(ctrl.upgrade));
router.post('/salir', ctrl.logout);

module.exports = router;
