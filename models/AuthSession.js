// Un intento de inicio de sesión con Google desde la app.
// La app lo crea con POST /api/v1/auth/google/start, el navegador lo completa
// en /auth/google/callback y la app recoge el resultado una sola vez.
module.exports = (sequelize, DataTypes) => {
  const AuthSession = sequelize.define('AuthSession', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    state: { type: DataTypes.STRING(128), allowNull: false, unique: true },
    poll_token_hash: { type: DataTypes.STRING(64), allowNull: false },
    code_verifier: { type: DataTypes.STRING(128), allowNull: false },
    mode: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'register', comment: 'register | migrate' },
    device_payload: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending', comment: 'pending | completed | failed | consumed' },
    result: { type: DataTypes.TEXT, allowNull: true },
    error: { type: DataTypes.STRING(255), allowNull: true },
    license_id: { type: DataTypes.INTEGER, allowNull: true },
    ip_address: { type: DataTypes.STRING(45), allowNull: true },
    expires_at: { type: DataTypes.DATE, allowNull: false }
  }, {
    tableName: 'auth_sessions',
    timestamps: true
  });

  return AuthSession;
};
