const { db, nextId, hashPassword, checkPassword } = require('../data/db');

const sanitize = ({ password, ...user }) => user;

function list({ page, limit, role }) {
  const rows = role ? db.users.filter((u) => u.role === role) : db.users;
  const offset = (page - 1) * limit;
  return { items: rows.slice(offset, offset + limit).map(sanitize), total: rows.length, page, limit };
}

function findById(id) {
  const user = db.users.find((u) => u.id === id);
  return user ? sanitize(user) : null;
}

function authenticate(email, password) {
  const user = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user || !checkPassword(password, user.password)) return null;
  return sanitize(user);
}

function emailOrUsernameTaken({ email, username }, exceptId) {
  return db.users.some(
    (u) => u.id !== exceptId && ((email && u.email === email) || (username && u.username === username)),
  );
}

function create(data) {
  const user = {
    id: nextId('users'),
    email: data.email,
    username: data.username,
    password: hashPassword(data.password),
    role: data.role,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  return sanitize(user);
}

function update(id, changes) {
  const user = db.users.find((u) => u.id === id);
  if (!user) return null;
  const { password, ...rest } = changes;
  Object.assign(user, rest);
  if (password) user.password = hashPassword(password);
  return sanitize(user);
}

function remove(id) {
  const idx = db.users.findIndex((u) => u.id === id);
  if (idx === -1) return false;
  db.users.splice(idx, 1);
  return true;
}

module.exports = { list, findById, authenticate, emailOrUsernameTaken, create, update, remove };
