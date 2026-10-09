const jwt = require('jsonwebtoken');
const asyncHandler = require('./async');
const ErrorResponse = require('../utils/errorResponse');
const config = require('../config');
const { db } = require('../data/store');

// Protect routes: requires "Authorization: Bearer <token>"
exports.protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(new ErrorResponse('Not authorized to access this route', 401));
  }

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    return next(new ErrorResponse('Not authorized to access this route', 401));
  }

  const user = db.users.find((u) => u.id === decoded.id);
  if (!user) {
    return next(new ErrorResponse('The user belonging to this token no longer exists', 401));
  }

  req.user = user;
  next();
});

// Grant access to specific roles
exports.authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return next(new ErrorResponse(`User role ${req.user.role} is not authorized to access this route`, 403));
  }
  next();
};
