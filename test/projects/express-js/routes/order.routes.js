const express = require('express');
const {
  getOrders,
  getOrder,
  createOrder,
  updateOrderStatus,
  cancelOrder,
} = require('../controllers/order.controller');
const { protect, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { listOrderRules, createOrderRules, updateStatusRules } = require('../validators/order.validator');

const router = express.Router();

router.use(protect);

router.route('/').get(listOrderRules, validate, getOrders).post(createOrderRules, validate, createOrder);

router.route('/:id').get(getOrder).delete(cancelOrder);

router.patch('/:id/status', authorize('admin'), updateStatusRules, validate, updateOrderStatus);

module.exports = router;
