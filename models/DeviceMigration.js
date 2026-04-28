module.exports = (sequelize, DataTypes) => {
  const DeviceMigration = sequelize.define('DeviceMigration', {
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
    old_device_id: {
      type: DataTypes.STRING(500),
      allowNull: false
    },
    old_device_name: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    new_device_id: {
      type: DataTypes.STRING(500),
      allowNull: false
    },
    new_device_name: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    migrated_by: {
      type: DataTypes.ENUM('admin', 'api', 'user'),
      defaultValue: 'admin'
    },
    ip_address: {
      type: DataTypes.STRING(45),
      allowNull: true
    },
    migrated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'device_migrations',
    timestamps: true
  });

  return DeviceMigration;
};
