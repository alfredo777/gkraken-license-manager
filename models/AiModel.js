// Modelo que se ofrece dentro del plan de IA. Los costos son del proveedor (USD
// por millón de tokens) y solo sirven para reportes de margen; lo que se descuenta
// del plan son tokens × token_factor.
module.exports = (sequelize, DataTypes) => sequelize.define('AiModel', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  provider_id: { type: DataTypes.INTEGER, allowNull: false },
  model_id: { type: DataTypes.STRING(120), allowNull: false },
  display_name: { type: DataTypes.STRING(120), allowNull: false },
  cost_input_per_mtok: { type: DataTypes.DECIMAL(10, 4), allowNull: false, defaultValue: 0 },
  cost_output_per_mtok: { type: DataTypes.DECIMAL(10, 4), allowNull: false, defaultValue: 0 },
  token_factor: { type: DataTypes.DECIMAL(6, 2), allowNull: false, defaultValue: 1 },
  max_output_tokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 8192 },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
}, { tableName: 'ai_models', timestamps: true, indexes: [{ unique: true, fields: ['provider_id', 'model_id'] }] });
