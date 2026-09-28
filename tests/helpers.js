jest.mock('../utils/mailer', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true }),
  sendActivationCode: jest.fn().mockResolvedValue({ success: true }),
  sendUnlockCode: jest.fn().mockResolvedValue({ success: true }),
  sendLicenseInfo: jest.fn().mockResolvedValue({ success: true }),
  sendMigrationNotification: jest.fn().mockResolvedValue({ success: true }),
  sendPaymentConfirmation: jest.fn().mockResolvedValue({ success: true })
}));

const request = require('supertest');
const app = require('../app');
const models = require('../models');

const API_KEY = process.env.API_KEY;
const api = {
  post: (path) => request(app).post(`/api/v1${path}`).set('X-API-Key', API_KEY),
  get: (path) => request(app).get(`/api/v1${path}`).set('X-API-Key', API_KEY)
};

const device = (id = 'device-aaa', extra = {}) => ({ device_id: id, device_name: 'Laptop', device_os: 'linux', device_cpu: 'x86', device_ram: '16GB', device_board: 'MB-1', device_disk_id: 'DISK-1', app_version: '2.0.0', ...extra });

const { upgradeSchema } = require('../utils/schemaUpgrade');
const resetDb = async () => { await models.sequelize.sync({ force: true }); await upgradeSchema(models.sequelize); };

const makeLicense = async (overrides = {}, deviceIds = ['device-aaa']) => {
  const license = await models.License.create({
    license_key: `FREE-${Math.random().toString(16).slice(2, 10).toUpperCase()}`, license_type: 'free', plan_type: 'free', status: 'active',
    start_date: new Date(), end_date: new Date(Date.now() + 365 * 864e5), name: 'Ana', email: 'ana@example.com', max_devices: 1, ...overrides
  });
  for (const id of deviceIds) await models.Device.create({ license_id: license.id, device_id: id, device_name: id, is_active: true, last_seen: new Date() });
  return license;
};

module.exports = { request, app, models, api, device, resetDb, makeLicense, API_KEY };
