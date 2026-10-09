const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const config = require('../config');
const { db, nextId } = require('../data/store');
const { sendTokenResponse, sanitizeUser } = require('../utils/tokens');

// @desc    Register user
// @route   POST /api/v1/auth/register
// @access  Public
exports.register = asyncHandler(async (req, res, next) => {
  const { name, username, email, password } = req.body;
  const normalizedEmail = email.toLowerCase();

  if (db.users.some((u) => u.email === normalizedEmail || u.username === username)) {
    return next(new ErrorResponse('A user with that email or username already exists', 409));
  }

  const user = {
    id: nextId('users'),
    name: name || username,
    username,
    email: normalizedEmail,
    password: await bcrypt.hash(password, 10),
    role: 'user',
    avatar: null,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);

  sendTokenResponse(user, 201, res);
});

// @desc    Login user
// @route   POST /api/v1/auth/login
// @access  Public
exports.login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;

  const user = db.users.find((u) => u.email === email.toLowerCase());
  if (!user) {
    return next(new ErrorResponse('Invalid credentials', 401));
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return next(new ErrorResponse('Invalid credentials', 401));
  }

  sendTokenResponse(user, 200, res);
});

// @desc    Exchange a refresh token for a new token pair
// @route   POST /api/v1/auth/refresh-token
// @access  Public
exports.refreshToken = asyncHandler(async (req, res, next) => {
  const { refreshToken } = req.body;

  if (!db.refreshTokens.has(refreshToken)) {
    return next(new ErrorResponse('Invalid refresh token', 401));
  }

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);
  } catch (err) {
    db.refreshTokens.delete(refreshToken);
    return next(new ErrorResponse('Refresh token expired or invalid', 401));
  }

  const user = db.users.find((u) => u.id === decoded.id);
  if (!user) {
    return next(new ErrorResponse('Invalid refresh token', 401));
  }

  // rotate
  db.refreshTokens.delete(refreshToken);
  sendTokenResponse(user, 200, res);
});

// @desc    Get current logged in user
// @route   GET /api/v1/auth/me
// @access  Private
exports.getMe = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: sanitizeUser(req.user) });
});

// @desc    Log out / revoke refresh token
// @route   POST /api/v1/auth/logout
// @access  Private
exports.logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    db.refreshTokens.delete(refreshToken);
  }
  res.status(200).json({ success: true, data: {} });
});
