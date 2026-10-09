import { type Context, createHttpError, type Next, Status } from "@oak/oak";
import { verifyToken } from "../utils/jwt.ts";

/** Requires a valid `Authorization: Bearer <jwt>` header; stores the claims on ctx.state.user. */
export async function authMiddleware(ctx: Context, next: Next) {
  const header = ctx.request.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    throw createHttpError(Status.Unauthorized, "Missing bearer token");
  }

  try {
    ctx.state.user = await verifyToken(match[1]);
  } catch {
    throw createHttpError(Status.Unauthorized, "Invalid or expired token");
  }

  await next();
}

export function requireRole(role: string) {
  return async (ctx: Context, next: Next) => {
    if (ctx.state.user?.role !== role) {
      throw createHttpError(Status.Forbidden, `Requires ${role} role`);
    }
    await next();
  };
}
