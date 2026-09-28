// Plan mensual de IA: cuántos tokens incluye y qué modelos permite.
module.exports = (sequelize, DataTypes) => sequelize.define('AiPlan', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  slug: { type: DataTypes.STRING(40), allowNull: false, unique: true },
  name: { type: DataTypes.STRING(80), allowNull: false },
  description: { type: DataTypes.STRING(255), allowNull: true },
  price_monthly: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  monthly_tokens: { type: DataTypes.BIGINT, allowNull: false },
  allowed_models: { type: DataTypes.TEXT, allowNull: false, defaultValue: '*', comment: '* o JSON con ids de ai_models' },
  rpm: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30 },
  max_concurrent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3 },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
}, { tableName: 'ai_plans', timestamps: true });
