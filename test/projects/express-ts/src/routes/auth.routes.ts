import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { loginSchema, registerSchema } from '../schemas/auth.schema.js';
import { authService } from '../services/index.js';

const controller = new AuthController(authService);

export const authRouter = Router();

authRouter.post('/register', validate({ body: registerSchema }), asyncHandler(controller.register));
authRouter.post('/login', validate({ body: loginSchema }), asyncHandler(controller.login));
authRouter.get('/me', requireAuth, asyncHandler(controller.me));
