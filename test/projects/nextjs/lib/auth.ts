import { NextRequest, NextResponse } from "next/server";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? "test-secret");

export interface SessionUser extends JWTPayload {
  sub: string;
  email: string;
  role: "admin" | "user";
}

export async function signToken(user: { id: string; email: string; role: string }) {
  return new SignJWT({ email: user.email, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
}

/**
 * Reads the bearer token from the Authorization header and verifies it.
 * Returns the session user, or null when the token is missing/invalid.
 */
export async function getSessionUser(request: NextRequest): Promise<SessionUser | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;

  try {
    const { payload } = await jwtVerify(header.slice(7), secret);
    return payload as SessionUser;
  } catch {
    return null;
  }
}

export function unauthorized(message = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
