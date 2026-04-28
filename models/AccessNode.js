module.exports = (sequelize, DataTypes) => {
  const AccessNode = sequelize.define('AccessNode', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    license_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'licenses', key: 'id' }
    },
    ip_address: {
      type: DataTypes.STRING(45),
      allowNull: false
    },
    country: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    region: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    city: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    timezone: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    latitude: {
      type: DataTypes.FLOAT,
      allowNull: true
    },
    longitude: {
      type: DataTypes.FLOAT,
      allowNull: true
    },
    action: {
      type: DataTypes.ENUM('verification', 'registration', 'login', 'unlock', 'upgrade', 'migration', 'renewal', 'payment'),
      defaultValue: 'verification'
    },
    user_agent: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    device_id: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    app_version: {
      type: DataTypes.STRING(20),
      allowNull: true
    },
    response_status: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      comment: 'true = válido, false = inválido'
    },
    accessed_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'access_nodes',
    timestamps: true
  });

  return AccessNode;
};
