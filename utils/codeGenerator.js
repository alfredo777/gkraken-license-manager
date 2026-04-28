const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const generateLicenseKey = (type = 'free') => {
  const prefix = type === 'pro' ? 'PRO' : 'FREE';
  const segments = [];
  for (let i = 0; i < 4; i++) {
    segments.push(crypto.randomBytes(2).toString('hex').toUpperCase());
  }
  return `${prefix}-${segments.join('-')}`;
};

const generateAccessCode = () => {
  return `AC-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
};

const generateActivationCode = () => crypto.randomInt(100000, 999999).toString();

const generateUnlockCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(crypto.randomInt(chars.length));
  }
  return code;
};

const generateDeviceHash = (deviceData) => {
  return crypto.createHash('sha256').update(JSON.stringify(deviceData)).digest('hex');
};

const generateUUID = () => uuidv4();

const generateTransactionRef = () => {
  return `TXN-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
};

module.exports = {
  generateLicenseKey, generateAccessCode, generateActivationCode,
  generateUnlockCode, generateDeviceHash, generateUUID, generateTransactionRef
};
