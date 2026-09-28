// Cifrado de las claves de API de los proveedores (AES-256-GCM).
// La clave maestra viene de AI_KEYS_MASTER_KEY (32 bytes en base64) y nunca se
// guarda en la base de datos. El AAD liga cada texto cifrado a su proveedor: una
// clave copiada a otra fila no se puede descifrar.
const crypto = require('crypto');

const masterKey = () => {
  const raw = process.env.AI_KEYS_MASTER_KEY || '';
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('AI_KEYS_MASTER_KEY debe ser 32 bytes en base64 (openssl rand -base64 32).');
  return key;
};

const isConfigured = () => { try { masterKey(); return true; } catch (_) { return false; } };

const seal = (plaintext, context) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  cipher.setAAD(Buffer.from(String(context)));
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
};

const open = ({ ciphertext, iv, tag }, context) => {
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64'));
  decipher.setAAD(Buffer.from(String(context)));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
};

// Guarda una clave nueva en la fila del proveedor (sin tocar otras columnas).
const setProviderKey = async (provider, apiKey) => {
  const box = seal(apiKey, `provider:${provider.slug}`);
  await provider.update({ key_ciphertext: box.ciphertext, key_iv: box.iv, key_tag: box.tag, key_last4: String(apiKey).slice(-4) });
};

const providerKey = (provider) => {
  if (!provider.key_ciphertext) return null;
  return open({ ciphertext: provider.key_ciphertext, iv: provider.key_iv, tag: provider.key_tag }, `provider:${provider.slug}`);
};

module.exports = { seal, open, isConfigured, setProviderKey, providerKey };
