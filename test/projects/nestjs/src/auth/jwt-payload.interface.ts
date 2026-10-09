import { Request } from 'express';

export interface JwtPayload {
  sub: number;
  email: string;
  username: string;
  role: string;
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}
