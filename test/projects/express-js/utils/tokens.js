const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { db } = require('../data/store');

const signAccessToken = (user) =>
  jwt.sign({ id: user.id, role: user.role }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });

const signRefreshToken = (user) => {
  const token = jwt.sign({ id: user.id, jti: crypto.randomUUID() }, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
  });
  db.refreshTokens.add(token);
  return token;
};

const sanitizeUser = (user) => {
  const { password, ...safe } = user;
  return safe;
};

const sendTokenResponse = (user, statusCode, res) => {
  res.status(statusCode).json({
    success: true,
    token: signAccessToken(user),
    refreshToken: signRefreshToken(user),
    user: sanitizeUser(user),
  });
};

module.exports = { signAccessToken, signRefreshToken, sanitizeUser, sendTokenResponse };
