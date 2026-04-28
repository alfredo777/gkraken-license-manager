module.exports = (sequelize, DataTypes) => {
  const Device = sequelize.define('Device', {
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
    device_id: {
      type: DataTypes.STRING(500),
      allowNull: false,
      comment: 'Identificador único del dispositivo (hash de hardware)'
    },
    device_name: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    device_os: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    device_os_version: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    device_cpu: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    device_ram: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    device_mac: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    device_motherboard: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    device_disk_serial: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    last_seen: {
      type: DataTypes.DATE,
      allowNull: true
    },
    registered_ip: {
      type: DataTypes.STRING(45),
      allowNull: true
    }
  }, {
    tableName: 'devices',
    timestamps: true
  });

  return Device;
};
