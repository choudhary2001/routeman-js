import { create, getNumericDate, verify } from "djwt";

const SECRET = Deno.env.get("JWT_SECRET") ?? "test-secret";

const key = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(SECRET),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"],
);

export interface TokenClaims {
  sub: string;
  email: string;
  role: string;
}

export function signToken(claims: TokenClaims): Promise<string> {
  return create(
    { alg: "HS256", typ: "JWT" },
    { ...claims, exp: getNumericDate(60 * 60 * 8) },
    key,
  );
}

export async function verifyToken(token: string): Promise<TokenClaims> {
  const payload = await verify(token, key);
  return payload as unknown as TokenClaims;
}
