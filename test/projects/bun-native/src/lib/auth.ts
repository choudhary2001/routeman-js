import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { error } from "./http";

const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? "test-secret");
const ISSUER = "bun-items-api";

export interface Claims extends JWTPayload {
  sub: string;
  email: string;
  role: string;
}

export async function signToken(user: { id: number; email: string; role: string }) {
  return new SignJWT({ email: user.email, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
}

/**
 * Returns the token claims, or a 401 Response the caller should return as-is.
 */
export async function authenticate(req: Request): Promise<Claims | Response> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return error(401, "Missing bearer token");
  }

  try {
    const { payload } = await jwtVerify(header.slice(7), secret, { issuer: ISSUER });
    return payload as Claims;
  } catch {
    return error(401, "Invalid or expired token");
  }
}

type Handler<R extends Request> = (req: R, user: Claims) => Response | Promise<Response>;

/** Wraps a route handler so it only runs for authenticated requests. */
export function withAuth<R extends Request>(handler: Handler<R>) {
  return async (req: R) => {
    const result = await authenticate(req);
    if (result instanceof Response) return result;
    return handler(req, result);
  };
}
