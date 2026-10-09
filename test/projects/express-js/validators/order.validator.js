const { body, query } = require('express-validator');

const STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];

exports.STATUSES = STATUSES;

exports.listOrderRules = [
  query('status').optional().isIn(STATUSES),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
];

exports.createOrderRules = [
  body('items').isArray({ min: 1 }).withMessage('Order must contain at least one item'),
  body('items.*.productId').isInt({ min: 1 }),
  body('items.*.quantity').isInt({ min: 1 }),
  body('shippingAddress').isObject().withMessage('Shipping address is required'),
  body('shippingAddress.street').trim().notEmpty(),
  body('shippingAddress.city').trim().notEmpty(),
  body('shippingAddress.postalCode').trim().notEmpty(),
  body('shippingAddress.country').trim().notEmpty(),
  body('paymentMethod').isIn(['card', 'paypal', 'cod']),
  body('notes').optional().isString().isLength({ max: 500 }),
];

exports.updateStatusRules = [body('status').isIn(STATUSES).withMessage(`Status must be one of ${STATUSES.join(', ')}`)];
