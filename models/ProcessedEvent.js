// Eventos de webhook ya procesados (Stripe). Evita aplicar dos veces el mismo
// evento, p. ej. reiniciar dos veces los tokens del periodo.
module.exports = (sequelize, DataTypes) => sequelize.define('ProcessedEvent', {
  event_id: { type: DataTypes.STRING(255), primaryKey: true },
  source: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'stripe' }
}, { tableName: 'processed_events', timestamps: true, updatedAt: false });
