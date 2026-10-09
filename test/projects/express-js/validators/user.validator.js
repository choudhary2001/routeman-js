const { body, param, query, checkSchema } = require('express-validator');

exports.idRule = [param('id').isInt({ min: 1 }).withMessage('User id must be a positive integer')];

exports.listUsersRules = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('role').optional().isIn(['user', 'admin']),
  query('search').optional().isString(),
];

exports.createUserRules = checkSchema({
  username: {
    in: ['body'],
    trim: true,
    isAlphanumeric: { errorMessage: 'Username must be alphanumeric' },
    isLength: { options: { min: 3, max: 30 }, errorMessage: 'Username must be 3-30 characters' },
  },
  email: {
    in: ['body'],
    trim: true,
    isEmail: { errorMessage: 'Invalid email address' },
  },
  password: {
    in: ['body'],
    isLength: { options: { min: 8 }, errorMessage: 'Password must be at least 8 characters' },
  },
  name: {
    in: ['body'],
    optional: true,
    isString: true,
  },
  role: {
    in: ['body'],
    optional: true,
    isIn: { options: [['user', 'admin']], errorMessage: 'Role must be user or admin' },
  },
});

exports.updateUserRules = [
  ...exports.idRule,
  body('name').optional().isString().trim(),
  body('username').optional().trim().isAlphanumeric().isLength({ min: 3, max: 30 }),
  body('email').optional().trim().isEmail(),
  body('role').optional().isIn(['user', 'admin']),
];
