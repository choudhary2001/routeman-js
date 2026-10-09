import { createHttpError, Router, Status } from "@oak/oak";
import { hashPassword, users } from "../data/store.ts";
import { signToken } from "../utils/jwt.ts";

export const authRouter = new Router();

authRouter.post("/login", async (ctx) => {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await ctx.request.body.json();
  } catch {
    throw createHttpError(Status.BadRequest, "Expected a JSON body");
  }

  const { email, password } = body;
  if (typeof email !== "string" || typeof password !== "string") {
    ctx.response.status = Status.UnprocessableEntity;
    ctx.response.body = { error: "email and password are required" };
    return;
  }

  const user = users.find((u) => u.email === email.toLowerCase());
  if (!user || user.passwordHash !== await hashPassword(password)) {
    throw createHttpError(Status.Unauthorized, "Invalid credentials");
  }

  const token = await signToken({ sub: user.id, email: user.email, role: user.role });
  ctx.response.body = { token, user: { id: user.id, email: user.email, role: user.role } };
});
