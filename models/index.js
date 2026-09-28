const { Sequelize } = require('sequelize');
const config = require('../config/database');

const env = process.env.NODE_ENV || 'development';
const dbConfig = config[env];

let sequelize;
if (dbConfig.dialect === 'sqlite') {
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: dbConfig.storage,
    logging: dbConfig.logging,
    define: dbConfig.define
  });
} else {
  sequelize = new Sequelize(dbConfig.database, dbConfig.username, dbConfig.password, dbConfig);
}

const Admin = require('./Admin')(sequelize, Sequelize.DataTypes);
const License = require('./License')(sequelize, Sequelize.DataTypes);
const Device = require('./Device')(sequelize, Sequelize.DataTypes);
const AccessNode = require('./AccessNode')(sequelize, Sequelize.DataTypes);
const Payment = require('./Payment')(sequelize, Sequelize.DataTypes);
const DeviceMigration = require('./DeviceMigration')(sequelize, Sequelize.DataTypes);
const AuthSession = require('./AuthSession')(sequelize, Sequelize.DataTypes);

// Associations
License.hasMany(Device, { foreignKey: 'license_id', as: 'devices' });
Device.belongsTo(License, { foreignKey: 'license_id', as: 'license' });

License.hasMany(AccessNode, { foreignKey: 'license_id', as: 'access_nodes' });
AccessNode.belongsTo(License, { foreignKey: 'license_id', as: 'license' });

License.hasMany(Payment, { foreignKey: 'license_id', as: 'payments' });
Payment.belongsTo(License, { foreignKey: 'license_id', as: 'license' });

License.hasMany(DeviceMigration, { foreignKey: 'license_id', as: 'migrations' });
DeviceMigration.belongsTo(License, { foreignKey: 'license_id', as: 'license' });

AuthSession.belongsTo(License, { foreignKey: 'license_id', as: 'license' });

module.exports = {
  sequelize,
  Sequelize,
  Admin,
  License,
  Device,
  AccessNode,
  Payment,
  DeviceMigration,
  AuthSession
};
