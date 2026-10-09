import { users } from "../lib/db";
import { signToken } from "../lib/auth";
import { error, json, readJson } from "../lib/http";

export async function login(req: Request) {
  const body = await readJson<{ username?: string; email?: string; password?: string }>(req);
  const identifier = body?.email ?? body?.username;

  if (typeof identifier !== "string" || typeof body?.password !== "string") {
    return error(400, "email (or username) and password are required");
  }

  const user = users.find((u) => u.email === identifier.toLowerCase() || u.username === identifier);
  if (!user || !(await Bun.password.verify(body.password, user.passwordHash))) {
    return error(401, "Invalid credentials");
  }

  const accessToken = await signToken(user);
  return json({ accessToken, tokenType: "Bearer", expiresIn: 7200 });
}
