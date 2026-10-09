import { type Context, isHttpError, type Next } from "@oak/oak";

export async function errorHandler(ctx: Context, next: Next) {
  try {
    await next();
  } catch (err) {
    if (isHttpError(err)) {
      ctx.response.status = err.status;
      ctx.response.body = { error: err.message };
    } else {
      console.error(err);
      ctx.response.status = 500;
      ctx.response.body = { error: "Internal Server Error" };
    }
  }
}

export async function requestLogger(ctx: Context, next: Next) {
  const start = performance.now();
  await next();
  const ms = (performance.now() - start).toFixed(1);
  console.log(`${ctx.request.method} ${ctx.request.url.pathname} ${ctx.response.status} ${ms}ms`);
}
