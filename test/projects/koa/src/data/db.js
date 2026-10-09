const crypto = require('crypto');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 32, 'sha256').toString('hex');
  return `${salt}$${hash}`;
}

function checkPassword(password, stored) {
  const [salt] = stored.split('$');
  const candidate = Buffer.from(hashPassword(password, salt));
  const expected = Buffer.from(stored);
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

const db = {
  users: [
    {
      id: 1,
      email: 'admin@example.com',
      username: 'admin',
      password: hashPassword('Str0ngPassw0rd!'),
      role: 'admin',
      createdAt: new Date('2024-01-01T00:00:00Z').toISOString(),
    },
  ],
  books: [
    {
      id: 1,
      title: 'The Pragmatic Programmer',
      author: 'Andrew Hunt',
      isbn: '9780135957059',
      genre: 'software',
      publishedYear: 2019,
      available: true,
    },
  ],
  sequences: { users: 1, books: 1 },
};

function nextId(collection) {
  db.sequences[collection] += 1;
  return db.sequences[collection];
}

module.exports = { db, nextId, hashPassword, checkPassword };
