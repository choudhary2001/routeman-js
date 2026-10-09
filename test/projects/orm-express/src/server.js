require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const mongoose = require('mongoose');
const sequelize = require('./db/sequelize');
const routes = require('./routes');

const app = express();

app.use(express.json());
app.use(morgan('dev'));

app.use('/api', routes);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

const PORT = process.env.PORT || 3000;

async function start() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/shop');
  await sequelize.sync();
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

start();
