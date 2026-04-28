const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const licenseCtrl = require('../controllers/licenseController');
const deviceCtrl = require('../controllers/deviceController');
const paymentCtrl = require('../controllers/paymentController');
const { AccessNode, License } = require('../models');

router.get('/', requireAuth, async (req, res) => {
  try {
    const stats = await licenseCtrl.dashboardStats();
    res.render('dashboard', { layout: 'main', title: 'Dashboard', stats, isDashboard: true });
  } catch (error) { console.error('Dashboard error:', error); res.render('dashboard', { layout: 'main', title: 'Dashboard', stats: {}, isDashboard: true }); }
});

router.get('/licenses', requireAuth, licenseCtrl.index);
router.get('/licenses/create', requireAuth, licenseCtrl.createPage);
router.post('/licenses', requireAuth, licenseCtrl.create);
router.get('/licenses/:id', requireAuth, licenseCtrl.view);
router.get('/licenses/:id/edit', requireAuth, licenseCtrl.editPage);
router.put('/licenses/:id', requireAuth, licenseCtrl.update);
router.delete('/licenses/:id', requireAuth, licenseCtrl.delete);
router.post('/licenses/:id/upgrade', requireAuth, licenseCtrl.upgrade);
router.post('/licenses/:id/renew', requireAuth, licenseCtrl.renew);
router.post('/licenses/:id/unlock', requireAuth, licenseCtrl.generateUnlock);

router.get('/devices', requireAuth, deviceCtrl.index);
router.get('/devices/migrate/:licenseId', requireAuth, deviceCtrl.migratePage);
router.post('/devices/migrate/:licenseId', requireAuth, deviceCtrl.migrate);
router.post('/devices/:id/deactivate', requireAuth, deviceCtrl.deactivate);

router.get('/payments', requireAuth, paymentCtrl.paymentHistory);
router.post('/payments/manual', requireAuth, paymentCtrl.manualPayment);

router.get('/access-logs', requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1; const limit = 50; const offset = (page - 1) * limit;
    const { count, rows } = await AccessNode.findAndCountAll({ include: [{ model: License, as: 'license', attributes: ['license_key', 'name'] }], order: [['accessed_at', 'DESC']], limit, offset });
    res.render('access-logs/index', { layout: 'main', title: 'Registros de Acceso', logs: rows.map(l => l.toJSON()), pagination: { page, totalPages: Math.ceil(count / limit), total: count, hasPrev: page > 1, hasNext: page < Math.ceil(count / limit) } });
  } catch (error) { req.flash('error_msg', 'Error.'); res.redirect('/dashboard'); }
});

module.exports = router;
