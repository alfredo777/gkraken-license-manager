// Suscripción de una licencia a un plan de IA. tokens_limit se copia del plan al
// empezar cada periodo; tokens_used se actualiza de forma atómica por el gateway.
module.exports = (sequelize, DataTypes) => sequelize.define('AiSubscription', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  license_id: { type: DataTypes.INTEGER, allowNull: false },
  plan_id: { type: DataTypes.INTEGER, allowNull: false },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'active', comment: 'active | past_due | canceled' },
  stripe_subscription_id: { type: DataTypes.STRING(255), allowNull: true, unique: true },
  period_start: { type: DataTypes.DATE, allowNull: false },
  period_end: { type: DataTypes.DATE, allowNull: false },
  tokens_used: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
  tokens_limit: { type: DataTypes.BIGINT, allowNull: false },
  cancel_at_period_end: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
}, { tableName: 'ai_subscriptions', timestamps: true });
