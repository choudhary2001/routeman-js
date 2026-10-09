const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const config = require('./config');
const routes = require('./routes');
const ErrorResponse = require('./utils/errorResponse');
const errorHandler = require('./middleware/error');

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors());

if (config.env === 'development') {
  app.use(morgan('dev'));
}

app.use('/uploads', express.static(config.uploads.dir));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
});

app.use('/api/v1', routes);

// 404 catch-all (Express 5 named wildcard syntax)
app.all('/{*splat}', (req, res, next) => {
  next(new ErrorResponse(`Not found - ${req.originalUrl}`, 404));
});

app.use(errorHandler);

module.exports = app;
