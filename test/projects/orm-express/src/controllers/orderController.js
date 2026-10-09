const prisma = require('../db/prisma');

async function listOrders(req, res) {
  const { status } = req.query;
  const orders = await prisma.order.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
  });
  res.json(orders);
}

async function createOrder(req, res) {
  const order = await prisma.order.create({ data: req.body });
  res.status(201).json(order);
}

async function getOrder(req, res) {
  const order = await prisma.order.findUnique({ where: { id: Number(req.params.orderId) } });
  if (!order) return res.status(404).json({ message: 'Order not found' });
  res.json(order);
}

async function updateOrder(req, res) {
  const order = await prisma.order.update({
    where: { id: Number(req.params.orderId) },
    data: req.body,
  });
  res.json(order);
}

module.exports = { listOrders, createOrder, getOrder, updateOrder };
