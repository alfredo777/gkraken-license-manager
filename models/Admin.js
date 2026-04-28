module.exports = (sequelize, DataTypes) => {
  const Admin = sequelize.define('Admin', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    username: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
      validate: { len: [3, 100] }
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: { isEmail: true }
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: false
    },
    password_hash: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    access_code: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Código de acceso para operaciones críticas'
    },
    activation_code: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Código de activación enviado por email'
    },
    activation_code_expires: {
      type: DataTypes.DATE,
      allowNull: true
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    role: {
      type: DataTypes.ENUM('superadmin', 'admin', 'support'),
      defaultValue: 'admin'
    },
    last_login: {
      type: DataTypes.DATE,
      allowNull: true
    },
    last_login_ip: {
      type: DataTypes.STRING(45),
      allowNull: true
    }
  }, {
    tableName: 'admins',
    timestamps: true
  });

  return Admin;
};
