// Registro de cada petición que pasó por el gateway de IA.
module.exports = (sequelize, DataTypes) => sequelize.define('AiUsage', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  license_id: { type: DataTypes.INTEGER, allowNull: false },
  subscription_id: { type: DataTypes.INTEGER, allowNull: true },
  token_id: { type: DataTypes.INTEGER, allowNull: true },
  ai_model_id: { type: DataTypes.INTEGER, allowNull: true },
  input_tokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  output_tokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  billed_tokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  cost_micros: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0, comment: 'costo del proveedor en millonésimas de USD' },
  status: { type: DataTypes.STRING(20), allowNull: false, comment: 'ok | estimated | error | aborted' },
  http_status: { type: DataTypes.INTEGER, allowNull: true },
  latency_ms: { type: DataTypes.INTEGER, allowNull: true },
  error: { type: DataTypes.STRING(255), allowNull: true }
}, { tableName: 'ai_usage', timestamps: true, updatedAt: false, indexes: [{ fields: ['license_id'] }, { fields: ['created_at'] }] });
