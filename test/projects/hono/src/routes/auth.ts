import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { sign } from 'hono/jwt'
import { db, toPublicUser } from '../lib/db'
import { env } from '../lib/env'
import { loginSchema } from '../lib/schemas'
import type { AppEnv, TokenPayload } from '../lib/types'
import { jwtAuth } from '../middleware/auth'

const auth = new Hono<AppEnv>()

auth.post('/login', zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json')
  const user = db.users.find((u) => u.email === email.toLowerCase())

  if (!user || user.password !== password) {
    return c.json({ error: 'Invalid email or password' }, 401)
  }

  const payload: TokenPayload = {
    sub: user.id,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + env.JWT_TTL_SECONDS,
  }
  const token = await sign(payload, env.JWT_SECRET, 'HS256')

  return c.json({ token, expiresIn: env.JWT_TTL_SECONDS, user: toPublicUser(user) })
})

auth.get('/me', jwtAuth, (c) => {
  const { sub } = c.get('jwtPayload')
  const user = db.users.find((u) => u.id === sub)
  if (!user) return c.json({ error: 'User not found' }, 404)
  return c.json(toPublicUser(user))
})

export default auth
