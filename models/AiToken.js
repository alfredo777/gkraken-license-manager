// Credencial de un dispositivo para usar la IA de Green Kraken. Solo se guarda
// su hash: el token en claro lo tiene únicamente la app de ese equipo.
module.exports = (sequelize, DataTypes) => sequelize.define('AiToken', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  license_id: { type: DataTypes.INTEGER, allowNull: false },
  device_id: { type: DataTypes.STRING(500), allowNull: true },
  device_name: { type: DataTypes.STRING(255), allowNull: true },
  token_hash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
  prefix: { type: DataTypes.STRING(16), allowNull: false },
  last_used_at: { type: DataTypes.DATE, allowNull: true },
  revoked_at: { type: DataTypes.DATE, allowNull: true }
}, { tableName: 'ai_tokens', timestamps: true });
