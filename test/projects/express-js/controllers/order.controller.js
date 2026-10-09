const asyncHandler = require('../middleware/async');
const ErrorResponse = require('../utils/errorResponse');
const { db, nextId } = require('../data/store');

const findOrder = (id) => db.orders.find((o) => o.id === Number(id));

// @desc    Get orders (own orders, or all for admins)
// @route   GET /api/v1/orders
// @access  Private
exports.getOrders = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const { status, limit = 20 } = req.query;

  let orders = req.user.role === 'admin' ? db.orders : db.orders.filter((o) => o.userId === req.user.id);
  if (status) orders = orders.filter((o) => o.status === status);

  const start = (page - 1) * Number(limit);
  res.status(200).json({ success: true, count: orders.length, data: orders.slice(start, start + Number(limit)) });
});

// @desc    Get single order
// @route   GET /api/v1/orders/:id
// @access  Private
exports.getOrder = asyncHandler(async (req, res, next) => {
  const order = findOrder(req.params.id);
  if (!order) {
    return next(new ErrorResponse(`Order not found with id of ${req.params.id}`, 404));
  }
  if (order.userId !== req.user.id && req.user.role !== 'admin') {
    return next(new ErrorResponse('Not authorized to view this order', 403));
  }
  res.status(200).json({ success: true, data: order });
});

// @desc    Place an order
// @route   POST /api/v1/orders
// @access  Private
exports.createOrder = asyncHandler(async (req, res, next) => {
  const { items, shippingAddress, paymentMethod, notes = null } = req.body;

  const lines = [];
  for (const item of items) {
    const product = db.products.find((p) => p.id === Number(item.productId));
    if (!product) {
      return next(new ErrorResponse(`Product ${item.productId} does not exist`, 400));
    }
    if (product.stock < Number(item.quantity)) {
      return next(new ErrorResponse(`Insufficient stock for ${product.name}`, 400));
    }
    lines.push({ product, quantity: Number(item.quantity) });
  }

  lines.forEach(({ product, quantity }) => {
    product.stock -= quantity;
  });

  const orderItems = lines.map(({ product, quantity }) => ({
    productId: product.id,
    name: product.name,
    quantity,
    price: product.price,
  }));

  const order = {
    id: nextId('orders'),
    userId: req.user.id,
    items: orderItems,
    total: Math.round(orderItems.reduce((sum, i) => sum + i.price * i.quantity, 0) * 100) / 100,
    status: 'pending',
    paymentMethod,
    shippingAddress,
    notes,
    createdAt: new Date().toISOString(),
  };
  db.orders.push(order);

  res.status(201).json({ success: true, data: order });
});

// @desc    Update order status
// @route   PATCH /api/v1/orders/:id/status
// @access  Private/Admin
exports.updateOrderStatus = asyncHandler(async (req, res, next) => {
  const order = findOrder(req.params.id);
  if (!order) {
    return next(new ErrorResponse(`Order not found with id of ${req.params.id}`, 404));
  }
  order.status = req.body.status;
  order.updatedAt = new Date().toISOString();
  res.status(200).json({ success: true, data: order });
});

// @desc    Cancel order
// @route   DELETE /api/v1/orders/:id
// @access  Private
exports.cancelOrder = asyncHandler(async (req, res, next) => {
  const order = findOrder(req.params.id);
  if (!order) {
    return next(new ErrorResponse(`Order not found with id of ${req.params.id}`, 404));
  }
  if (order.userId !== req.user.id && req.user.role !== 'admin') {
    return next(new ErrorResponse('Not authorized to cancel this order', 403));
  }
  if (['shipped', 'delivered'].includes(order.status)) {
    return next(new ErrorResponse(`Cannot cancel an order that is already ${order.status}`, 400));
  }

  if (order.status !== 'cancelled') {
    order.items.forEach((item) => {
      const product = db.products.find((p) => p.id === item.productId);
      if (product) product.stock += item.quantity;
    });
    order.status = 'cancelled';
  }

  res.status(200).json({ success: true, data: order });
});
