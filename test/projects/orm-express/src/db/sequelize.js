const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(process.env.PG_URL || 'postgres://postgres:postgres@localhost:5432/shop', {
  dialect: 'postgres',
  logging: false,
});

module.exports = sequelize;
