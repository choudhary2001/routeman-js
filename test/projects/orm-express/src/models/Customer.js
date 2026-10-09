const { DataTypes } = require('sequelize');
const sequelize = require('../db/sequelize');

const Customer = sequelize.define(
  'Customer',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    firstName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    lastName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },
    phone: DataTypes.STRING,
    tier: {
      type: DataTypes.ENUM('basic', 'silver', 'gold'),
      defaultValue: 'basic',
    },
    marketingOptIn: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
  },
  {
    tableName: 'customers',
    timestamps: true,
  }
);

module.exports = Customer;
