require('dotenv').config();
const { runStartupChecks } = require('./utils/startupChecks');
runStartupChecks();

const app = require('./app');
const { sequelize, Admin } = require('./models');
const { upgradeSchema } = require('./utils/schemaUpgrade');
const { bootstrapAdmin } = require('./utils/adminBootstrap');
const cronJobs = require('./utils/cronJobs');

const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await sequelize.sync({ alter: process.env.NODE_ENV === 'development' });
    const added = await upgradeSchema(sequelize);
    if (added.length) console.log(`🧩 Columnas nuevas en licenses: ${added.join(', ')}`);
    const admin = await bootstrapAdmin(Admin);
    if (admin.created) console.log(`✅ Superadmin inicial creado: ${admin.username}`);
    else if (admin.reason === 'missing_password') console.warn('⚠️  No hay admins. Define ADMIN_INITIAL_PASSWORD y reinicia (o usa npm run seed).');
    cronJobs.startAll();
    app.listen(PORT, () => {
      console.log(`🚀 Servidor: http://localhost:${PORT}`);
      console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
      console.log(`🔌 API: http://localhost:${PORT}/api/v1`);
    });
  } catch (err) {
    console.error('❌ Error al arrancar:', err.message);
    process.exitCode = 1;
  }
})();
