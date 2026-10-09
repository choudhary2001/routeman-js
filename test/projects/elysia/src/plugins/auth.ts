import { Elysia, type Context } from 'elysia'
import { jwt } from '@elysiajs/jwt'
import type { Role } from '../db'

export interface AuthUser {
  id: number
  role: Role
}

export const jwtPlugin = new Elysia({ name: 'plugin.jwt' }).use(
  jwt({
    name: 'jwt',
    secret: process.env.JWT_SECRET ?? 'test-secret',
    exp: '7d',
  }),
)

/**
 * Resolves the current user from the `Authorization: Bearer` header.
 * `user` is null for anonymous requests - routes decide whether that's allowed.
 */
export const authPlugin = new Elysia({ name: 'plugin.auth' })
  .use(jwtPlugin)
  .derive({ as: 'scoped' }, async ({ headers, jwt }): Promise<{ user: AuthUser | null }> => {
    const authorization = headers['authorization']
    if (!authorization?.startsWith('Bearer ')) return { user: null }

    const payload = await jwt.verify(authorization.slice('Bearer '.length))
    if (!payload || !payload.sub) return { user: null }

    return { user: { id: Number(payload.sub), role: payload.role as Role } }
  })

type GuardContext = { user: AuthUser | null; set: Context['set'] }

export const isAuthenticated = ({ user, set }: GuardContext) => {
  if (!user) {
    set.status = 401
    return { message: 'Unauthorized' }
  }
}

export const isAdmin = ({ user, set }: GuardContext) => {
  if (!user) {
    set.status = 401
    return { message: 'Unauthorized' }
  }
  if (user.role !== 'admin') {
    set.status = 403
    return { message: 'Admin access required' }
  }
}
