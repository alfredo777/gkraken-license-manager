// Comprobaciones de configuración al arrancar. En producción, una configuración
// insegura detiene el servidor en lugar de arrancar con valores por defecto.
const crypto = require('crypto');

// SHA-256 de la API key que quedó publicada en el historial de green-kraken.
// Se guarda solo el hash para no volver a escribir la clave en claro.
const LEAKED_API_KEY_HASHES = ['fe835511ee1ae37c7b06f0866616ecd3a9e47b785d236fbfdbea21cc6f674349'];

const EXAMPLE_VALUES = ['change_this_super_secret_session_key_now_12345', 'change_this_jwt_secret_key_now_67890'];

const problems = (env = process.env) => {
  const out = [];
  const isProd = env.NODE_ENV === 'production';
  for (const name of ['SESSION_SECRET', 'JWT_SECRET']) {
    const v = env[name];
    if (!v) out.push(`${name} no está configurado.`);
    else if (EXAMPLE_VALUES.includes(v) || v.length < 32) out.push(`${name} usa el valor de ejemplo o tiene menos de 32 caracteres.`);
  }
  if (env.API_KEY) {
    const hash = crypto.createHash('sha256').update(env.API_KEY).digest('hex');
    if (LEAKED_API_KEY_HASHES.includes(hash)) out.push('API_KEY es la clave filtrada en el historial de green-kraken: genera una nueva.');
    else if (env.API_KEY.length < 32) out.push('API_KEY debe tener al menos 32 caracteres.');
  } else if (isProd) out.push('API_KEY no está configurada.');
  return out;
};

const runStartupChecks = (env = process.env) => {
  const found = problems(env);
  if (found.length === 0) return;
  if (env.NODE_ENV === 'production') {
    throw new Error(`Configuración insegura:\n - ${found.join('\n - ')}`);
  }
  found.forEach(p => console.warn(`⚠️  ${p}`));
};

module.exports = { runStartupChecks, problems, LEAKED_API_KEY_HASHES };
