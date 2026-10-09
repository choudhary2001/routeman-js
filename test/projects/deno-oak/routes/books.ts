import { type Context, createHttpError, Router, Status } from "@oak/oak";
import { type Book, books, nextBookId } from "../data/store.ts";
import { authMiddleware, requireRole } from "../middleware/auth.ts";

type BookInput = Partial<Omit<Book, "id">>;

const booksRouter = new Router();

async function readBook(ctx: Context, partial: boolean): Promise<BookInput> {
  let input: BookInput;
  try {
    input = await ctx.request.body.json();
  } catch {
    throw createHttpError(Status.BadRequest, "Expected a JSON body");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createHttpError(Status.BadRequest, "Expected a JSON object");
  }

  const errors: string[] = [];
  if (!partial || input.title !== undefined) {
    if (typeof input.title !== "string" || !input.title.trim()) errors.push("title is required");
  }
  if (!partial || input.author !== undefined) {
    if (typeof input.author !== "string" || !input.author.trim()) errors.push("author is required");
  }
  if (input.isbn !== undefined && !/^\d{10}(\d{3})?$/.test(String(input.isbn))) {
    errors.push("isbn must be 10 or 13 digits");
  }
  if (input.year !== undefined && !Number.isInteger(input.year)) errors.push("year must be an integer");
  if (input.genres !== undefined && !Array.isArray(input.genres)) errors.push("genres must be an array");

  if (errors.length) {
    throw createHttpError(Status.UnprocessableEntity, errors.join("; "));
  }

  const { title, author, isbn, year, genres } = input;
  return Object.fromEntries(
    Object.entries({ title, author, isbn, year, genres }).filter(([, v]) => v !== undefined),
  ) as BookInput;
}

booksRouter
  .get("/", (ctx) => {
    const author = ctx.request.url.searchParams.get("author");
    const genre = ctx.request.url.searchParams.get("genre");
    const limit = Number(ctx.request.url.searchParams.get("limit") ?? 25);

    let result = [...books.values()];
    if (author) {
      result = result.filter((b) => b.author.toLowerCase().includes(author.toLowerCase()));
    }
    if (genre) result = result.filter((b) => b.genres.includes(genre));

    ctx.response.body = result.slice(0, Number.isFinite(limit) && limit > 0 ? limit : 25);
  })
  .get("/:id", (ctx) => {
    const book = books.get(ctx.params.id);
    if (!book) throw createHttpError(Status.NotFound, `Book ${ctx.params.id} not found`);
    ctx.response.body = book;
  })
  .post("/", authMiddleware, async (ctx) => {
    const input = await readBook(ctx, false);
    if (input.isbn && [...books.values()].some((b) => b.isbn === input.isbn)) {
      throw createHttpError(Status.Conflict, `A book with ISBN ${input.isbn} already exists`);
    }

    const book: Book = { genres: [], ...input, id: nextBookId() } as Book;
    books.set(book.id, book);

    ctx.response.status = Status.Created;
    ctx.response.headers.set("Location", `/api/books/${book.id}`);
    ctx.response.body = book;
  })
  .put("/:id", authMiddleware, async (ctx) => {
    const book = books.get(ctx.params.id);
    if (!book) throw createHttpError(Status.NotFound, `Book ${ctx.params.id} not found`);

    Object.assign(book, await readBook(ctx, true));
    ctx.response.body = book;
  })
  .delete("/:id", authMiddleware, requireRole("admin"), (ctx) => {
    if (!books.delete(ctx.params.id)) {
      throw createHttpError(Status.NotFound, `Book ${ctx.params.id} not found`);
    }
    ctx.response.status = Status.NoContent;
  });

export default booksRouter;
