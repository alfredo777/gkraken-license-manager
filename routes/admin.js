const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/adminController');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');

router.get('/login', ctrl.loginPage);
router.post('/login', ctrl.login);
router.get('/logout', ctrl.logout);
router.post('/activate', ctrl.activate);
router.post('/resend-activation', ctrl.resendActivation);
router.post('/register', requireAuth, requireSuperAdmin, ctrl.register);
router.get('/profile', requireAuth, ctrl.profilePage);
router.post('/profile', requireAuth, ctrl.updateProfile);
router.get('/settings', requireAuth, requireSuperAdmin, ctrl.settingsPage);

module.exports = router;
