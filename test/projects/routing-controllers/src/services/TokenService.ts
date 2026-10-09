import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'test-secret';

export interface TokenPayload {
  sub: number;
  role: 'admin' | 'customer';
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: '12h' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, SECRET) as unknown as TokenPayload;
  } catch {
    return null;
  }
}
