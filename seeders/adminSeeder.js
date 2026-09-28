// npm run seed: crea el primer superadmin con ADMIN_INITIAL_* del .env.
require('dotenv').config();
const { sequelize, Admin } = require('../models');
const { bootstrapAdmin } = require('../utils/adminBootstrap');

(async () => {
  try {
    await sequelize.sync();
    const r = await bootstrapAdmin(Admin);
    if (r.created) console.log(`✅ Superadmin creado: ${r.username}`);
    else if (r.reason === 'exists') console.log('ℹ️  Ya existe al menos un admin; no se creó ninguno.');
    else console.log('⚠️  Define ADMIN_INITIAL_PASSWORD (mínimo 12 caracteres) en el .env.');
    process.exitCode = 0;
  } catch (e) {
    console.error('❌', e.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
