const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { requireApiAuth, requireApiKey } = require('../middleware/auth');
const { ipTrackerMiddleware } = require('../middleware/ipTracker');
const verifyCtrl = require('../controllers/verificationController');
const clientCtrl = require('../controllers/clientApiController');
const googleCtrl = require('../controllers/googleAuthController');
const licenseCtrl = require('../controllers/licenseController');
const deviceCtrl = require('../controllers/deviceController');
const adminCtrl = require('../controllers/adminController');
const paymentCtrl = require('../controllers/paymentController');

// Límite más estricto para las rutas que crean cosas (licencias, sesiones de login).
const strictLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, skip: () => process.env.NODE_ENV === 'test', standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'Demasiados intentos. Espera unos minutos.' } });

router.use(ipTrackerMiddleware);

// Admin (JWT)
router.post('/auth/login', strictLimiter, adminCtrl.apiLogin);

// App Green Kraken (X-API-Key)
router.post('/register', requireApiKey, strictLimiter, clientCtrl.register);
router.post('/verify', requireApiKey, clientCtrl.verify);
router.post('/migrate', requireApiKey, clientCtrl.migrate);
router.post('/upgrade/checkout', requireApiKey, strictLimiter, clientCtrl.checkout);
router.get('/upgrade/status/:license_key', requireApiKey, clientCtrl.upgradeStatus);
router.post('/auth/google/start', requireApiKey, strictLimiter, googleCtrl.start);
router.get('/auth/google/status/:id', requireApiKey, googleCtrl.status);
router.post('/verify/unlock', requireApiKey, verifyCtrl.verifyUnlockCode);
router.post('/unlock/request', requireApiKey, strictLimiter, verifyCtrl.requestUnlockCode);
router.get('/license/:license_key', requireApiKey, verifyCtrl.getLicenseInfo);

// Administración (JWT)
router.post('/licenses', requireApiAuth, licenseCtrl.create);
router.put('/licenses/:id', requireApiAuth, licenseCtrl.update);
router.post('/licenses/:id/upgrade', requireApiAuth, licenseCtrl.upgrade);
router.post('/licenses/:id/unlock', requireApiAuth, licenseCtrl.generateUnlock);
router.post('/devices/migrate', requireApiAuth, deviceCtrl.migrate);
router.post('/payments/stripe/intent', requireApiAuth, paymentCtrl.stripeCreateIntent);
router.post('/payments/stripe/subscription', requireApiAuth, paymentCtrl.stripeCreateSubscription);
router.post('/payments/paypal/create', requireApiAuth, paymentCtrl.paypalCreateOrder);
router.post('/payments/bitcoin/create', requireApiAuth, paymentCtrl.bitcoinCreateCharge);
router.post('/payments/manual', requireApiAuth, paymentCtrl.manualPayment);

// API info
router.get('/', (req, res) => {
  res.json({
    name: process.env.APP_NAME, version: '1.1.0',
    endpoints: {
      google_start: 'POST /api/v1/auth/google/start', google_status: 'GET /api/v1/auth/google/status/:id',
      verify: 'POST /api/v1/verify', checkout: 'POST /api/v1/upgrade/checkout', upgrade_status: 'GET /api/v1/upgrade/status/:key',
      unlock: 'POST /api/v1/verify/unlock', auth: 'POST /api/v1/auth/login'
    }
  });
});

module.exports = router;
