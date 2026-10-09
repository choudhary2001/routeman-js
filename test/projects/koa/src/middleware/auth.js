const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Reads "Authorization: Bearer <token>", verifies it and stores the payload on ctx.state.user.
 */
async function requireAuth(ctx, next) {
  const header = ctx.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    ctx.throw(401, 'Missing or malformed Authorization header');
  }

  try {
    ctx.state.user = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    ctx.throw(401, err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token');
  }

  await next();
}

function requireRole(...roles) {
  return async (ctx, next) => {
    if (!ctx.state.user || !roles.includes(ctx.state.user.role)) {
      ctx.throw(403, 'Insufficient permissions');
    }
    await next();
  };
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn },
  );
}

module.exports = { requireAuth, requireRole, signToken };
