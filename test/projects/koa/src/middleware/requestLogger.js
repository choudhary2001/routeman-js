module.exports = function requestLogger() {
  return async (ctx, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    ctx.set('X-Response-Time', `${ms}ms`);
    if (process.env.NODE_ENV !== 'test') {
      console.log(`${ctx.method} ${ctx.originalUrl} ${ctx.status} - ${ms}ms`);
    }
  };
};
