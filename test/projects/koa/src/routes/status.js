const Router = require('@koa/router');
const pkg = require('../../package.json');

const router = new Router();

router.get('status', '/status', (ctx) => {
  ctx.body = {
    status: 'ok',
    version: pkg.version,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
});

module.exports = router;
