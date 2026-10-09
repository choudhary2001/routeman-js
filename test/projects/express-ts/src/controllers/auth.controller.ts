import type { Request, Response } from 'express';
import type { LoginInput, RegisterInput } from '../schemas/auth.schema.js';
import type { AuthService } from '../services/auth.service.js';

export class AuthController {
  constructor(private readonly auth: AuthService) {}

  register = async (req: Request<unknown, unknown, RegisterInput>, res: Response) => {
    const result = await this.auth.register(req.body);
    res.status(201).json(result);
  };

  login = async (req: Request<unknown, unknown, LoginInput>, res: Response) => {
    const tokens = await this.auth.login(req.body);
    res.json(tokens);
  };

  me = async (req: Request, res: Response) => {
    res.json(this.auth.getProfile(req.user!.id));
  };
}
