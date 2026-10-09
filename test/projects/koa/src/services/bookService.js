const { db, nextId } = require('../data/db');

function search({ q, author, genre, available, page, limit }) {
  let rows = db.books;
  if (q) {
    const term = q.toLowerCase();
    rows = rows.filter(
      (b) => b.title.toLowerCase().includes(term) || b.author.toLowerCase().includes(term) || b.isbn === q,
    );
  }
  if (author) rows = rows.filter((b) => b.author.toLowerCase() === author.toLowerCase());
  if (genre) rows = rows.filter((b) => b.genre === genre);
  if (available !== undefined) rows = rows.filter((b) => b.available === available);

  const offset = (page - 1) * limit;
  return { data: rows.slice(offset, offset + limit), meta: { total: rows.length, page, limit } };
}

const findById = (id) => db.books.find((b) => b.id === id) || null;

const findByIsbn = (isbn) => db.books.find((b) => b.isbn === isbn) || null;

function create(data) {
  const book = { id: nextId('books'), available: true, ...data };
  db.books.push(book);
  return book;
}

function update(id, data) {
  const book = findById(id);
  if (!book) return null;
  Object.assign(book, data);
  return book;
}

function remove(id) {
  const idx = db.books.findIndex((b) => b.id === id);
  if (idx === -1) return false;
  db.books.splice(idx, 1);
  return true;
}

module.exports = { search, findById, findByIsbn, create, update, remove };
