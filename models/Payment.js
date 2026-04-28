module.exports = (sequelize, DataTypes) => {
  const Payment = sequelize.define('Payment', {
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
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    currency: {
      type: DataTypes.STRING(5),
      defaultValue: 'USD'
    },
    method: {
      type: DataTypes.ENUM('stripe', 'paypal', 'bitcoin', 'manual'),
      allowNull: false
    },
    plan_type: {
      type: DataTypes.ENUM('monthly', 'annual'),
      allowNull: false
    },
    transaction_id: {
      type: DataTypes.STRING(500),
      allowNull: true,
      unique: true
    },
    status: {
      type: DataTypes.ENUM('pending', 'completed', 'failed', 'refunded', 'cancelled'),
      defaultValue: 'pending'
    },
    payment_details: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'JSON con detalles adicionales del pago'
    },
    ip_address: {
      type: DataTypes.STRING(45),
      allowNull: true
    },
    paid_at: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'payments',
    timestamps: true
  });

  return Payment;
};
