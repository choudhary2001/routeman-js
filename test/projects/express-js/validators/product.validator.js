const { body, query } = require('express-validator');

exports.listProductRules = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('sort').optional().isIn(['price', '-price', 'name', '-name', 'createdAt', '-createdAt']),
  query('category').optional().isString(),
  query('search').optional().isString(),
  query('minPrice').optional().isFloat({ min: 0 }),
  query('maxPrice').optional().isFloat({ min: 0 }),
];

exports.createProductRules = [
  body('name').trim().notEmpty().withMessage('Product name is required'),
  body('description').optional().isString(),
  body('price').isFloat({ gt: 0 }).withMessage('Price must be a positive number'),
  body('category').trim().notEmpty().withMessage('Category is required'),
  body('stock').optional().isInt({ min: 0 }),
];

exports.updateProductRules = [
  body('name').optional().trim().notEmpty(),
  body('description').optional().isString(),
  body('price').optional().isFloat({ gt: 0 }),
  body('category').optional().trim().notEmpty(),
  body('stock').optional().isInt({ min: 0 }),
];

exports.reviewRules = [
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('comment').optional().isString().isLength({ max: 500 }),
];
