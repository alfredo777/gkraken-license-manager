const forge = require('node-forge');
const crypto = require('crypto');
const CryptoJS = require('crypto-js');

const generateKeyPair = () => {
  const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 });
  return {
    privateKey: forge.pki.privateKeyToPem(keypair.privateKey),
    publicKey: forge.pki.publicKeyToPem(keypair.publicKey)
  };
};

const generateCertificate = (name, email) => {
  const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keypair.publicKey;
  cert.serialNumber = '01' + crypto.randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const attrs = [
    { name: 'commonName', value: name },
    { name: 'emailAddress', value: email },
    { name: 'organizationName', value: process.env.APP_NAME || 'LicenseManager' }
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keypair.privateKey, forge.md.sha256.create());

  return {
    certificate: forge.pki.certificateToPem(cert),
    privateKey: forge.pki.privateKeyToPem(keypair.privateKey),
    publicKey: forge.pki.publicKeyToPem(keypair.publicKey),
    fingerprint: forge.pki.getPublicKeyFingerprint(keypair.publicKey, { encoding: 'hex', delimiter: ':' })
  };
};

const generateEncryptionKey = () => crypto.randomBytes(32).toString('hex');

const encryptData = (data, key) => CryptoJS.AES.encrypt(JSON.stringify(data), key).toString();

const decryptData = (encrypted, key) => {
  const bytes = CryptoJS.AES.decrypt(encrypted, key);
  return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
};

module.exports = { generateKeyPair, generateCertificate, generateEncryptionKey, encryptData, decryptData };
