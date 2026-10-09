import { Router } from "@oak/oak";
import { authRouter } from "./auth.ts";
import booksRouter from "./books.ts";

export const apiRouter = new Router({ prefix: "/api" });

apiRouter.get("/health", (ctx) => {
  ctx.response.body = { status: "ok", deno: Deno.version.deno };
});

apiRouter.use("/auth", authRouter.routes(), authRouter.allowedMethods());
apiRouter.use("/books", booksRouter.routes(), booksRouter.allowedMethods());
