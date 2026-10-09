const Router = require('@koa/router');
const { validate, validateQuery } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const schemas = require('../validators/users');
const users = require('../services/userService');

const router = new Router();

// every /users endpoint needs a logged-in user
router.use(requireAuth);

router.param('id', async (id, ctx, next) => {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 1) ctx.throw(400, 'id must be a positive integer');
  ctx.state.userId = numericId;
  return next();
});

router.get('/', validateQuery(schemas.listUsers), async (ctx) => {
  ctx.body = users.list(ctx.state.query);
});

router.get('user', '/:id', async (ctx) => {
  const user = users.findById(ctx.state.userId);
  if (!user) ctx.throw(404, `User ${ctx.params.id} not found`);
  ctx.body = user;
});

router.post('/', requireRole('admin'), validate(schemas.createUser), async (ctx) => {
  if (users.emailOrUsernameTaken(ctx.request.body)) ctx.throw(409, 'Email or username already in use');
  const user = users.create(ctx.request.body);
  ctx.status = 201;
  ctx.set('Location', `${ctx.path.replace(/\/$/, '')}/${user.id}`);
  ctx.body = user;
});

router.put('/:id', validate(schemas.updateUser), async (ctx) => {
  const id = ctx.state.userId;
  const me = ctx.state.user;
  if (me.sub !== id && me.role !== 'admin') ctx.throw(403, 'You can only edit your own account');
  if (ctx.request.body.role && me.role !== 'admin') ctx.throw(403, 'Only admins can change roles');
  if (users.emailOrUsernameTaken(ctx.request.body, id)) ctx.throw(409, 'Email or username already in use');

  const user = users.update(id, ctx.request.body);
  if (!user) ctx.throw(404, `User ${ctx.params.id} not found`);
  ctx.body = user;
});

router.del('/:id', requireRole('admin'), async (ctx) => {
  if (!users.remove(ctx.state.userId)) ctx.throw(404, `User ${ctx.params.id} not found`);
  ctx.status = 204;
});

module.exports = router;
