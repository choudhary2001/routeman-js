import { Elysia, NotFoundError, t } from 'elysia'
import { authPlugin, isAdmin, isAuthenticated } from '../plugins/auth'
import { sanitize, users } from '../db'

const userParams = t.Object({ id: t.Numeric({ minimum: 1 }) })

export const usersModule = new Elysia({ prefix: '/users' })
  .use(authPlugin)
  .get(
    '/',
    ({ query: { page = 1, limit = 20, role } }) => {
      const list = role ? users.filter((u) => u.role === role) : users
      const offset = (page - 1) * limit
      return {
        items: list.slice(offset, offset + limit).map(sanitize),
        page,
        limit,
        total: list.length,
      }
    },
    {
      beforeHandle: isAdmin,
      query: t.Object({
        page: t.Optional(t.Numeric({ minimum: 1 })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        role: t.Optional(t.Union([t.Literal('admin'), t.Literal('customer')])),
      }),
      detail: { summary: 'List users', tags: ['Users'] },
    },
  )
  .get(
    '/me',
    ({ user }) => {
      const me = users.find((u) => u.id === user!.id)
      if (!me) throw new NotFoundError('User not found')
      return sanitize(me)
    },
    { beforeHandle: isAuthenticated, detail: { summary: 'Current user', tags: ['Users'] } },
  )
  .get(
    '/:id',
    ({ params: { id }, user, set }) => {
      if (user!.role !== 'admin' && user!.id !== id) {
        set.status = 403
        return { message: 'Forbidden' }
      }
      const found = users.find((u) => u.id === id)
      if (!found) throw new NotFoundError('User not found')
      return sanitize(found)
    },
    { beforeHandle: [isAuthenticated], params: userParams },
  )
  .patch(
    '/:id',
    ({ params: { id }, body, user, set }) => {
      if (user!.role !== 'admin' && user!.id !== id) {
        set.status = 403
        return { message: 'Forbidden' }
      }
      if (body.role && user!.role !== 'admin') {
        set.status = 403
        return { message: 'Only admins can change roles' }
      }

      const found = users.find((u) => u.id === id)
      if (!found) throw new NotFoundError('User not found')

      if (body.email) found.email = body.email.toLowerCase()
      if (body.fullName !== undefined) found.fullName = body.fullName
      if (body.role) found.role = body.role
      return sanitize(found)
    },
    {
      beforeHandle: [isAuthenticated],
      params: userParams,
      body: t.Object({
        email: t.Optional(t.String({ format: 'email' })),
        fullName: t.Optional(t.String({ maxLength: 100 })),
        role: t.Optional(t.Union([t.Literal('admin'), t.Literal('customer')])),
      }),
    },
  )
  .delete(
    '/:id',
    ({ params: { id }, set }) => {
      const index = users.findIndex((u) => u.id === id)
      if (index === -1) throw new NotFoundError('User not found')
      users.splice(index, 1)
      set.status = 204
    },
    { beforeHandle: isAdmin, params: userParams, detail: { summary: 'Delete a user', tags: ['Users'] } },
  )
