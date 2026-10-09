const Router = require('@koa/router');
const authRouter = require('./auth');
const usersRouter = require('./users');
const booksRouter = require('./books');

const apiRouter = new Router({ prefix: '/api/v1' });

apiRouter.use('/auth', authRouter.routes(), authRouter.allowedMethods());
apiRouter.use('/users', usersRouter.routes(), usersRouter.allowedMethods());
apiRouter.use(booksRouter.routes(), booksRouter.allowedMethods());

module.exports = apiRouter;
