import { Elysia, t } from 'elysia'
import { jwtPlugin } from '../plugins/auth'
import { nextId, sanitize, users } from '../db'

export const authModels = new Elysia({ name: 'models.auth' }).model({
  'auth.login': t.Object({
    email: t.String({ format: 'email' }),
    password: t.String({ minLength: 1 }),
  }),
  'auth.register': t.Object({
    email: t.String({ format: 'email' }),
    username: t.String({ minLength: 3, maxLength: 30 }),
    password: t.String({ minLength: 8 }),
    fullName: t.Optional(t.String()),
  }),
})

export const auth = new Elysia({ prefix: '/auth' })
  .use(jwtPlugin)
  .use(authModels)
  .post(
    '/register',
    async ({ body, jwt, set }) => {
      const email = body.email.toLowerCase()
      if (users.some((u) => u.email === email || u.username === body.username)) {
        set.status = 409
        return { message: 'Email or username already taken' }
      }

      const user = {
        id: nextId('users'),
        email,
        username: body.username,
        password: body.password,
        fullName: body.fullName,
        role: 'customer' as const,
      }
      users.push(user)

      set.status = 201
      return {
        user: sanitize(user),
        accessToken: await jwt.sign({ sub: String(user.id), role: user.role }),
      }
    },
    {
      body: 'auth.register',
      detail: { summary: 'Create a customer account', tags: ['Auth'] },
    },
  )
  .post(
    '/login',
    async ({ body, jwt, set }) => {
      const user = users.find((u) => u.email === body.email.toLowerCase())
      if (!user || user.password !== body.password) {
        set.status = 401
        return { message: 'Invalid credentials' }
      }

      const accessToken = await jwt.sign({ sub: String(user.id), role: user.role })
      return { accessToken, tokenType: 'Bearer', user: sanitize(user) }
    },
    {
      body: 'auth.login',
      detail: { summary: 'Exchange credentials for a JWT', tags: ['Auth'] },
    },
  )
