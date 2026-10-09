import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { db, nextId, toPublicUser } from '../lib/db'
import { createUserSchema, idParam, listUsersQuery } from '../lib/schemas'
import type { AppEnv, Role, User } from '../lib/types'
import { requireRole } from '../middleware/auth'

const users = new Hono<AppEnv>()

users.get('/', zValidator('query', listUsersQuery), (c) => {
  const { page, limit, role } = c.req.valid('query')
  const filtered = role ? db.users.filter((u) => u.role === role) : db.users
  const start = (page - 1) * limit

  return c.json({
    data: filtered.slice(start, start + limit).map(toPublicUser),
    meta: { page, limit, total: filtered.length },
  })
})

users.get('/:id', zValidator('param', idParam), (c) => {
  const { id } = c.req.valid('param')
  const user = db.users.find((u) => u.id === id)
  if (!user) return c.json({ error: 'User not found' }, 404)
  return c.json(toPublicUser(user))
})

users.post('/', requireRole('admin'), zValidator('json', createUserSchema), (c) => {
  const input = c.req.valid('json')
  const email = input.email.toLowerCase()

  if (db.users.some((u) => u.email === email || u.username === input.username)) {
    return c.json({ error: 'A user with that email or username already exists' }, 409)
  }

  const user: User = {
    ...input,
    email,
    id: nextId('users'),
    avatarUrl: null,
    createdAt: new Date().toISOString(),
  }
  db.users.push(user)
  return c.json(toPublicUser(user), 201)
})

// Partial update - the body is read loosely and only known keys are applied.
users.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const user = db.users.find((u) => u.id === id)
  if (!user) return c.json({ error: 'User not found' }, 404)

  let body: { name?: unknown; email?: unknown; role?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Malformed JSON body' }, 400)
  }
  const { name, email, role } = body

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) return c.json({ error: 'name must be a non-empty string' }, 400)
    user.name = name.trim()
  }
  if (email !== undefined) {
    if (typeof email !== 'string' || !email.includes('@')) return c.json({ error: 'email is invalid' }, 400)
    user.email = email.toLowerCase()
  }
  if (role !== undefined) {
    if (c.get('jwtPayload').role !== 'admin') return c.json({ error: 'Only admins can change roles' }, 403)
    if (!['admin', 'editor', 'reader'].includes(role as string)) return c.json({ error: 'role is invalid' }, 400)
    user.role = role as Role
  }

  return c.json(toPublicUser(user))
})

users.delete('/:id', requireRole('admin'), (c) => {
  const id = Number(c.req.param('id'))
  const index = db.users.findIndex((u) => u.id === id)
  if (index === -1) return c.json({ error: 'User not found' }, 404)
  db.users.splice(index, 1)
  return c.body(null, 204)
})

users.post('/:id/avatar', async (c) => {
  const id = Number(c.req.param('id'))
  const user = db.users.find((u) => u.id === id)
  if (!user) return c.json({ error: 'User not found' }, 404)

  const body = await c.req.parseBody()
  const avatar = body['avatar']
  if (!(avatar instanceof File)) {
    return c.json({ error: 'avatar file is required' }, 400)
  }
  if (avatar.size > 2 * 1024 * 1024) {
    return c.json({ error: 'avatar must be 2MB or smaller' }, 400)
  }

  user.avatarUrl = `/uploads/avatars/${user.id}-${encodeURIComponent(avatar.name)}`
  return c.json({ avatarUrl: user.avatarUrl, size: avatar.size, type: avatar.type })
})

export default users
