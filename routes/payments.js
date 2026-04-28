const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/paymentController');

router.get('/checkout', ctrl.checkoutPage);
router.get('/success', ctrl.successPage);
router.post('/stripe/create-intent', ctrl.stripeCreateIntent);
router.post('/stripe/create-subscription', ctrl.stripeCreateSubscription);
router.post('/paypal/create-order', ctrl.paypalCreateOrder);
router.get('/paypal/success', ctrl.paypalSuccess);
router.get('/paypal/cancel', ctrl.paypalCancel);
router.post('/bitcoin/create-charge', ctrl.bitcoinCreateCharge);
router.get('/bitcoin/success', ctrl.bitcoinSuccess);
router.get('/bitcoin/cancel', ctrl.bitcoinCancel);
router.post('/webhook/bitcoin', ctrl.bitcoinWebhook);

module.exports = router;
