module.exports = function errorHandler() {
  return async (ctx, next) => {
    try {
      await next();
      if (ctx.status === 404 && ctx.body === undefined) {
        ctx.status = 404;
        ctx.body = { error: 'Not Found', message: `No route for ${ctx.method} ${ctx.path}` };
      }
    } catch (err) {
      const status = err.status || err.statusCode || 500;
      ctx.status = status;
      ctx.body = {
        error: err.name && status < 500 ? err.name : 'InternalServerError',
        message: status < 500 || err.expose ? err.message : 'Something went wrong',
        ...(err.details ? { details: err.details } : {}),
      };
      if (status >= 500) ctx.app.emit('error', err, ctx);
    }
  };
};
