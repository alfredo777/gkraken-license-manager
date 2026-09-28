// Arranque del gateway de IA: npm run gateway
require('dotenv').config();
const { runStartupChecks } = require('./utils/startupChecks');
const { isConfigured } = require('./utils/secretBox');
runStartupChecks();
if (!isConfigured()) {
  console.error('❌ AI_KEYS_MASTER_KEY no está configurada (32 bytes en base64: openssl rand -base64 32).');
  process.exit(1);
}

const cluster = require('cluster');
const WORKERS = Math.max(1, Number(process.env.GATEWAY_WORKERS || 1));

// Con GATEWAY_WORKERS > 1 se levanta una copia por núcleo detrás del mismo puerto.
// Cada copia toma sus propios préstamos de cuota (la reserva sigue siendo atómica).
if (WORKERS > 1 && cluster.isPrimary) {
  for (let i = 0; i < WORKERS; i++) cluster.fork();
  cluster.on('exit', (worker, code) => { if (code !== 0) { console.error(`Gateway: la copia ${worker.process.pid} terminó (${code}); se reinicia.`); cluster.fork(); } });
  process.on('SIGTERM', () => { for (const w of Object.values(cluster.workers)) w.process.kill('SIGTERM'); });
  return;
}

const app = require('./gatewayApp');
const { sequelize } = require('./models');
const usageLog = require('./gateway/usageLog');
const quota = require('./gateway/quota');

const PORT = process.env.GATEWAY_PORT || 3100;

(async () => {
  try {
    await sequelize.sync();
    usageLog.start();
    quota.start();
    const server = app.listen(PORT, () => console.log(`🐙 Gateway de IA: http://localhost:${PORT}`));
    // Las respuestas en streaming pueden durar minutos.
    server.requestTimeout = 0;
    server.headersTimeout = 65000;
    server.keepAliveTimeout = 61000;
    const shutdown = async () => { server.close(); await quota.stop(); await usageLog.stop(); await sequelize.close(); process.exit(0); };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (err) {
    console.error('❌ Error al arrancar el gateway:', err.message);
    process.exitCode = 1;
  }
})();
