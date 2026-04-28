const express = require('express');
const router = express.Router();
const { requireApiAuth } = require('../middleware/auth');
const { ipTrackerMiddleware } = require('../middleware/ipTracker');
const verifyCtrl = require('../controllers/verificationController');
const licenseCtrl = require('../controllers/licenseController');
const deviceCtrl = require('../controllers/deviceController');
const adminCtrl = require('../controllers/adminController');
const paymentCtrl = require('../controllers/paymentController');

router.use(ipTrackerMiddleware);

// Auth
router.post('/auth/login', adminCtrl.apiLogin);

// Public verification
router.post('/verify', verifyCtrl.verifyLicense);
router.post('/verify/unlock', verifyCtrl.verifyUnlockCode);
router.post('/unlock/request', verifyCtrl.requestUnlockCode);
router.get('/license/:license_key', verifyCtrl.getLicenseInfo);

// Protected
router.post('/licenses', requireApiAuth, licenseCtrl.create);
router.put('/licenses/:id', requireApiAuth, async (req, res) => { req.headers['content-type'] = 'application/json'; await licenseCtrl.update(req, res); });
router.post('/licenses/:id/upgrade', requireApiAuth, async (req, res) => { req.headers['content-type'] = 'application/json'; await licenseCtrl.upgrade(req, res); });
router.post('/licenses/:id/unlock', requireApiAuth, licenseCtrl.generateUnlock);
router.post('/devices/migrate', requireApiAuth, deviceCtrl.migrate);
router.post('/payments/stripe/intent', requireApiAuth, paymentCtrl.stripeCreateIntent);
router.post('/payments/stripe/subscription', requireApiAuth, paymentCtrl.stripeCreateSubscription);
router.post('/payments/paypal/create', requireApiAuth, paymentCtrl.paypalCreateOrder);
router.post('/payments/bitcoin/create', requireApiAuth, paymentCtrl.bitcoinCreateCharge);
router.post('/payments/manual', requireApiAuth, paymentCtrl.manualPayment);

// API info
router.get('/', (req, res) => {
  res.json({ name: process.env.APP_NAME, version: '1.0.0', endpoints: { verify: 'POST /api/v1/verify', unlock: 'POST /api/v1/verify/unlock', license_info: 'GET /api/v1/license/:key', auth: 'POST /api/v1/auth/login' } });
});

module.exports = router;
