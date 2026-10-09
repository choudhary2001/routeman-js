import { Application } from "@oak/oak";
import { apiRouter } from "./routes/mod.ts";
import { errorHandler, requestLogger } from "./middleware/errors.ts";

const port = Number(Deno.env.get("PORT") ?? 3000);

const app = new Application();

app.use(errorHandler);
app.use(requestLogger);
app.use(apiRouter.routes());
app.use(apiRouter.allowedMethods());

app.use((ctx) => {
  ctx.response.status = 404;
  ctx.response.body = { error: `Not found: ${ctx.request.method} ${ctx.request.url.pathname}` };
});

app.addEventListener("listen", ({ hostname, port }) => {
  console.log(`Library API listening on http://${hostname ?? "localhost"}:${port}`);
});

await app.listen({ port });
