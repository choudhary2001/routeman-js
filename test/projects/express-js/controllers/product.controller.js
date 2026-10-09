const ErrorResponse = require('../utils/errorResponse');

const SORTERS = {
  price: (a, b) => a.price - b.price,
  name: (a, b) => a.name.localeCompare(b.name),
  createdAt: (a, b) => a.createdAt.localeCompare(b.createdAt),
};

class ProductController {
  constructor(store, nextId) {
    this.db = store;
    this.nextId = nextId;
  }

  findOrFail(id) {
    const product = this.db.products.find((p) => p.id === Number(id));
    if (!product) {
      throw new ErrorResponse(`Product not found with id of ${id}`, 404);
    }
    return product;
  }

  // GET /api/v1/products
  async list(req, res) {
    const page = Number(req.query.page) || 1;
    const { sort, limit = 10, category, search, minPrice, maxPrice } = req.query;

    let products = [...this.db.products];
    if (category) products = products.filter((p) => p.category === category);
    if (search) products = products.filter((p) => p.name.toLowerCase().includes(String(search).toLowerCase()));
    if (minPrice) products = products.filter((p) => p.price >= Number(minPrice));
    if (maxPrice) products = products.filter((p) => p.price <= Number(maxPrice));

    if (sort) {
      const desc = sort.startsWith('-');
      const sorter = SORTERS[desc ? sort.slice(1) : sort];
      if (sorter) products.sort((a, b) => (desc ? sorter(b, a) : sorter(a, b)));
    }

    const perPage = Number(limit);
    const start = (page - 1) * perPage;
    res.json({
      success: true,
      count: products.length,
      pagination: { page, limit: perPage },
      data: products.slice(start, start + perPage).map(({ reviews, ...p }) => ({ ...p, reviewCount: reviews.length })),
    });
  }

  // GET /api/v1/products/:id
  async get(req, res) {
    res.json({ success: true, data: this.findOrFail(req.params.id) });
  }

  // POST /api/v1/products
  async create(req, res) {
    const { name, description = '', price, category, stock = 0 } = req.body;

    if (this.db.products.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new ErrorResponse(`Product "${name}" already exists`, 409);
    }

    const product = {
      id: this.nextId('products'),
      name,
      description,
      price: Number(price),
      category,
      stock: Number(stock),
      reviews: [],
      createdAt: new Date().toISOString(),
    };
    this.db.products.push(product);
    res.status(201).json({ success: true, data: product });
  }

  // PUT /api/v1/products/:id
  async update(req, res) {
    const product = this.findOrFail(req.params.id);
    const allowed = ['name', 'description', 'price', 'category', 'stock'];
    for (const key of allowed) {
      if (req.body && req.body[key] !== undefined) {
        product[key] = key === 'price' || key === 'stock' ? Number(req.body[key]) : req.body[key];
      }
    }
    product.updatedAt = new Date().toISOString();
    res.json({ success: true, data: product });
  }

  // DELETE /api/v1/products/:id
  async remove(req, res) {
    const product = this.findOrFail(req.params.id);
    this.db.products = this.db.products.filter((p) => p !== product);
    res.json({ success: true, data: {} });
  }

  // GET /api/v1/products/:id/reviews
  async listReviews(req, res) {
    const product = this.findOrFail(req.params.id);
    res.json({ success: true, count: product.reviews.length, data: product.reviews });
  }

  // POST /api/v1/products/:id/reviews
  async addReview(req, res) {
    const product = this.findOrFail(req.params.id);
    const { rating, comment = '' } = req.body;
    const review = {
      id: this.nextId('reviews'),
      userId: req.user.id,
      rating: Number(rating),
      comment,
      createdAt: new Date().toISOString(),
    };
    product.reviews.push(review);
    res.status(201).json({ success: true, data: review });
  }
}

module.exports = ProductController;
