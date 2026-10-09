const { body, check } = require('express-validator');

exports.registerRules = [
  check('name').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Name must be 2-50 characters'),
  check('username', 'Username must be 3-30 alphanumeric characters').trim().isAlphanumeric().isLength({ min: 3, max: 30 }),
  check('email', 'Please include a valid email').trim().isEmail(),
  check('password', 'Password must be at least 8 characters').isLength({ min: 8 }),
];

exports.loginRules = [
  body('email').trim().isEmail().withMessage('Please include a valid email'),
  body('password').notEmpty().withMessage('Password is required'),
];

exports.refreshRules = [
  body('refreshToken').notEmpty().withMessage('Refresh token is required').bail().isJWT().withMessage('Malformed refresh token'),
];

exports.logoutRules = [body('refreshToken').optional().isJWT()];
