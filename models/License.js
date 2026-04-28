module.exports = (sequelize, DataTypes) => {
  const License = sequelize.define('License', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    license_key: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true
    },
    license_type: {
      type: DataTypes.ENUM('free', 'pro'),
      defaultValue: 'free'
    },
    plan_type: {
      type: DataTypes.ENUM('monthly', 'annual', 'lifetime', 'free'),
      defaultValue: 'free'
    },
    status: {
      type: DataTypes.ENUM('active', 'expired', 'suspended', 'pending', 'cancelled'),
      defaultValue: 'pending'
    },
    start_date: {
      type: DataTypes.DATE,
      allowNull: true
    },
    end_date: {
      type: DataTypes.DATE,
      allowNull: true
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: { isEmail: true }
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: true
    },
    country: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    country_code: {
      type: DataTypes.STRING(5),
      allowNull: true
    },
    user_role: {
      type: DataTypes.ENUM('estudiante', 'docente', 'programador', 'emprendedor', 'investigador'),
      defaultValue: 'programador'
    },
    encryption_key: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    encryption_certificate: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    app_version: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: '1.0.0'
    },
    last_app_update: {
      type: DataTypes.DATE,
      allowNull: true
    },
    unlock_code: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: 'Código dinámico para desbloquear la app'
    },
    unlock_code_expires: {
      type: DataTypes.DATE,
      allowNull: true
    },
    auto_renew: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    stripe_customer_id: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    stripe_subscription_id: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    paypal_subscription_id: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    registration_ip: {
      type: DataTypes.STRING(45),
      allowNull: true
    },
    registration_country: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    registration_city: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    last_verification_ip: {
      type: DataTypes.STRING(45),
      allowNull: true
    },
    last_verification_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    total_verifications: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    tableName: 'licenses',
    timestamps: true
  });

  return License;
};
