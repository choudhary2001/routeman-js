import jwt from 'jsonwebtoken';
import { HttpError } from './respond.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

export function signToken(user) {
  return jwt.sign({ sub: String(user.id), username: user.username, role: user.role }, JWT_SECRET, {
    expiresIn: '1h',
  });
}

// Throws 401 unless the request carries a valid "Authorization: Bearer <token>" header.
export function requireAuth(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw new HttpError(401, 'Authentication required');
  }

  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    throw new HttpError(401, err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token');
  }
}
