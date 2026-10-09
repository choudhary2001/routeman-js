import 'reflect-metadata';
import express from 'express';
import { Action, useExpressServer } from 'routing-controllers';
import { AuthController } from './controllers/AuthController';
import { UserController } from './controllers/UserController';
import { OrderController } from './controllers/OrderController';
import { verifyToken } from './services/TokenService';
import { userService } from './services/UserService';

const app = express();

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

useExpressServer(app, {
  routePrefix: '/api',
  controllers: [AuthController, UserController, OrderController],
  validation: { whitelist: true, forbidNonWhitelisted: true },
  classTransformer: true,
  defaultErrorHandler: true,
  authorizationChecker: async (action: Action, roles: string[]) => {
    const header: string | undefined = action.request.headers['authorization'];
    const payload = header?.startsWith('Bearer ') ? verifyToken(header.slice(7)) : null;
    if (!payload) return false;
    return roles.length === 0 || roles.includes(payload.role);
  },
  currentUserChecker: async (action: Action) => {
    const header: string | undefined = action.request.headers['authorization'];
    const payload = header ? verifyToken(header.replace('Bearer ', '')) : null;
    return payload ? userService.findById(payload.sub) : undefined;
  },
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`API listening on :${port}`));
