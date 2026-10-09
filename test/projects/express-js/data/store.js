const bcrypt = require('bcryptjs');

// Simple in-memory "database". Swap for a real DB in production.
const db = {
  users: [],
  products: [],
  orders: [],
  refreshTokens: new Set(),
};

const counters = { users: 0, products: 0, orders: 0, reviews: 0 };

const nextId = (collection) => {
  counters[collection] += 1;
  return counters[collection];
};

const seed = async () => {
  const salt = await bcrypt.genSalt(10);
  const now = new Date().toISOString();

  db.users.push(
    {
      id: nextId('users'),
      name: 'Site Admin',
      username: 'admin',
      email: 'admin@example.com',
      password: await bcrypt.hash('Str0ngPassw0rd!', salt),
      role: 'admin',
      avatar: null,
      createdAt: now,
    },
    {
      id: nextId('users'),
      name: 'Jane Doe',
      username: 'jane',
      email: 'jane@example.com',
      password: await bcrypt.hash('Passw0rd!123', salt),
      role: 'user',
      avatar: null,
      createdAt: now,
    },
  );

  db.products.push(
    {
      id: nextId('products'),
      name: 'Mechanical Keyboard',
      description: 'Tenkeyless keyboard with hot-swappable switches',
      price: 89.99,
      category: 'electronics',
      stock: 25,
      reviews: [{ id: nextId('reviews'), userId: 2, rating: 5, comment: 'Love the switches', createdAt: now }],
      createdAt: now,
    },
    {
      id: nextId('products'),
      name: 'Coffee Mug',
      description: 'Ceramic mug, 350ml',
      price: 12.5,
      category: 'kitchen',
      stock: 120,
      reviews: [],
      createdAt: now,
    },
  );

  db.orders.push({
    id: nextId('orders'),
    userId: 1,
    items: [{ productId: 1, name: 'Mechanical Keyboard', quantity: 1, price: 89.99 }],
    total: 89.99,
    status: 'pending',
    paymentMethod: 'card',
    shippingAddress: { street: '1 Main St', city: 'Springfield', postalCode: '12345', country: 'US' },
    notes: null,
    createdAt: now,
  });
};

module.exports = { db, nextId, seed };
