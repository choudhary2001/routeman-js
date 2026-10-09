import type { RequestHandler } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { config } from '../config.js';
import { db, type Role } from '../services/db.js';
import { HttpError } from '../lib/httpError.js';

interface AccessTokenPayload extends JwtPayload {
  sub: string;
  role: Role;
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    return next(HttpError.unauthorized('Missing bearer token'));
  }

  try {
    const payload = jwt.verify(header.slice('Bearer '.length), config.jwt.secret) as AccessTokenPayload;
    const user = db.users.get(payload.sub);
    if (!user) {
      return next(HttpError.unauthorized('User no longer exists'));
    }
    req.user = { id: user.id, email: user.email, role: user.role };
    return next();
  } catch {
    return next(HttpError.unauthorized('Invalid or expired token'));
  }
};
