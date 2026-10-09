const express = require('express');
const ProductController = require('../controllers/product.controller');
const { protect, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { db, nextId } = require('../data/store');
const {
  listProductRules,
  createProductRules,
  updateProductRules,
  reviewRules,
} = require('../validators/product.validator');

const router = express.Router();
const products = new ProductController(db, nextId);

router
  .route('/')
  .get(listProductRules, validate, products.list.bind(products))
  .post(protect, authorize('admin'), createProductRules, validate, products.create.bind(products));

router
  .route('/:id')
  .get(products.get.bind(products))
  .put(protect, authorize('admin'), updateProductRules, validate, products.update.bind(products))
  .delete(protect, authorize('admin'), products.remove.bind(products));

router.get('/:id/reviews', products.listReviews.bind(products));
router.post('/:id/reviews', protect, reviewRules, validate, products.addReview.bind(products));

module.exports = router;
