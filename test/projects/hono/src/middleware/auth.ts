import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { jwt } from 'hono/jwt'
import { env } from '../lib/env'
import type { AppEnv, Role } from '../lib/types'

export const jwtAuth = jwt({ secret: env.JWT_SECRET, alg: 'HS256' })

export const requireRole = (...roles: Role[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const payload = c.get('jwtPayload')
    if (!payload || !roles.includes(payload.role)) {
      throw new HTTPException(403, { message: 'Forbidden' })
    }
    await next()
  })
