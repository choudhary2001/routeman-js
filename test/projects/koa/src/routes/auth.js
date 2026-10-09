const Router = require('@koa/router');
const { validate } = require('../middleware/validate');
const { requireAuth, signToken } = require('../middleware/auth');
const schemas = require('../validators/auth');
const users = require('../services/userService');

const router = new Router();

router.post('/login', validate(schemas.login), async (ctx) => {
  const { email, password } = ctx.request.body;
  const user = users.authenticate(email, password);
  if (!user) ctx.throw(401, 'Invalid credentials');

  ctx.body = { token: signToken(user), tokenType: 'Bearer', user };
});

router.get('/me', requireAuth, async (ctx) => {
  const user = users.findById(ctx.state.user.sub);
  if (!user) ctx.throw(404, 'User not found');
  ctx.body = user;
});

module.exports = router;
