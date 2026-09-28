// Agrega columnas nuevas a tablas existentes sin depender de sync({alter}).
// Es idempotente: en producción sync() no altera tablas, así que las columnas
// que se agregaron después del primer despliegue se crean aquí.
const NEW_LICENSE_COLUMNS = (DataTypes) => ({
  max_devices: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  features: { type: DataTypes.TEXT, allowNull: true },
  google_sub: { type: DataTypes.STRING(255), allowNull: true },
  auth_provider: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'manual' },
  avatar_url: { type: DataTypes.STRING(1024), allowNull: true }
});

const upgradeSchema = async (sequelize) => {
  const qi = sequelize.getQueryInterface();
  const { DataTypes } = require('sequelize');
  const existing = await qi.describeTable('licenses');
  const added = [];
  for (const [column, spec] of Object.entries(NEW_LICENSE_COLUMNS(DataTypes))) {
    if (!existing[column]) { await qi.addColumn('licenses', column, spec); added.push(column); }
  }
  const indexes = await qi.showIndex('licenses');
  if (!indexes.some(i => i.name === 'licenses_google_sub_unique' || (i.unique && i.fields?.some(f => f.attribute === 'google_sub')))) {
    await qi.addIndex('licenses', ['google_sub'], { unique: true, name: 'licenses_google_sub_unique' });
  }
  if (sequelize.getDialect() === 'postgres') {
    for (const role of ['empresa', 'otro']) {
      await sequelize.query(`ALTER TYPE "enum_licenses_user_role" ADD VALUE IF NOT EXISTS '${role}'`);
    }
  }
  return added;
};

module.exports = { upgradeSchema };
