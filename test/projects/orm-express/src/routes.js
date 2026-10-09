const express = require('express');
const { protect } = require('./middleware/auth');
const userController = require('./controllers/userController');
const { getProducts, createProduct, updateProduct, deleteProduct } = require('./controllers/productController');
const orders = require('./controllers/orderController');
const customers = require('./controllers/customerController');

const router = express.Router();

// auth
router.post('/auth/register', userController.register);
router.post('/auth/login', userController.login);

// users
router.get('/users', protect, userController.getUsers);
router.get('/users/:id', protect, userController.getUser);

// products (mongoose)
router.route('/products').get(getProducts).post(protect, createProduct);
router.route('/products/:id').put(protect, updateProduct).delete(protect, deleteProduct);

// orders (prisma)
router.get('/orders', protect, orders.listOrders);
router.post('/orders', protect, orders.createOrder);
router.get('/orders/:orderId', protect, orders.getOrder);
router.patch('/orders/:orderId', protect, orders.updateOrder);

// customers (sequelize)
router.post('/customers', customers.create);
router.get('/customers/:id', customers.show);

module.exports = router;
