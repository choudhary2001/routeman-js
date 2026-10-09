const Router = require('@koa/router');
const { validate, validateQuery } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const schemas = require('../validators/books');
const books = require('../services/bookService');

const router = new Router({ prefix: '/books' });

async function loadBook(ctx, next) {
  const book = books.findById(Number(ctx.params.id));
  if (!book) ctx.throw(404, 'Book not found');
  ctx.state.book = book;
  await next();
}

router
  .get('books', '/', validateQuery(schemas.searchBooks), async (ctx) => {
    ctx.body = books.search(ctx.state.query);
  })
  .get('book', '/:id', loadBook, async (ctx) => {
    ctx.body = ctx.state.book;
  })
  .post('/', requireAuth, requireRole('admin', 'librarian'), validate(schemas.createBook), async (ctx) => {
    const { isbn } = ctx.request.body;
    if (isbn && books.findByIsbn(isbn)) ctx.throw(409, `A book with ISBN ${isbn} already exists`);
    const book = books.create(ctx.request.body);
    ctx.status = 201;
    ctx.set('Location', router.url('book', { id: book.id }));
    ctx.body = book;
  })
  .put('/:id', requireAuth, requireRole('admin', 'librarian'), loadBook, validate(schemas.updateBook), async (ctx) => {
    ctx.body = books.update(ctx.state.book.id, ctx.request.body);
  })
  .delete('/:id', requireAuth, requireRole('admin'), loadBook, async (ctx) => {
    books.remove(ctx.state.book.id);
    ctx.status = 204;
  });

module.exports = router;
