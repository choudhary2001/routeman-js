const Koa = require('koa');
const { bodyParser } = require('@koa/bodyparser');

const errorHandler = require('./middleware/errorHandler');
const requestLogger = require('./middleware/requestLogger');
const statusRouter = require('./routes/status');
const apiRouter = require('./routes');

const app = new Koa();

app.use(errorHandler());
app.use(requestLogger());
app.use(bodyParser({ enableTypes: ['json'], jsonLimit: '1mb' }));

app.use(statusRouter.routes()).use(statusRouter.allowedMethods());
app.use(apiRouter.routes()).use(apiRouter.allowedMethods());

app.on('error', (err, ctx) => {
  if (!err.expose) console.error('unhandled error', ctx && ctx.path, err);
});

module.exports = app;
