// Proveedor de IA que contrata Monter Labs (Anthropic, xAI, OpenAI, Google…).
// La clave de API se guarda cifrada (utils/secretBox.js) y nunca sale del servidor.
module.exports = (sequelize, DataTypes) => sequelize.define('AiProvider', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  slug: { type: DataTypes.STRING(40), allowNull: false, unique: true },
  name: { type: DataTypes.STRING(80), allowNull: false },
  api_format: { type: DataTypes.STRING(20), allowNull: false, comment: 'anthropic | openai | gemini' },
  base_url: { type: DataTypes.STRING(255), allowNull: false },
  key_ciphertext: { type: DataTypes.TEXT, allowNull: true },
  key_iv: { type: DataTypes.STRING(40), allowNull: true },
  key_tag: { type: DataTypes.STRING(40), allowNull: true },
  key_last4: { type: DataTypes.STRING(8), allowNull: true },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
}, { tableName: 'ai_providers', timestamps: true });
