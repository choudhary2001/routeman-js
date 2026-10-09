import { publicUser } from '../../../lib/store.js'
import { hashPassword, verifyPassword } from '../../../lib/password.js'

const loginSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 1 }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        expiresIn: { type: 'integer' }
      }
    }
  }
}

const registerSchema = {
  body: {
    type: 'object',
    required: ['email', 'username', 'password'],
    properties: {
      email: { type: 'string', format: 'email' },
      username: { type: 'string', minLength: 3, maxLength: 30, pattern: '^[a-zA-Z0-9_]+$' },
      password: { type: 'string', minLength: 8 },
      name: { type: 'string', maxLength: 100 }
    },
    additionalProperties: false
  }
}

export default async function (fastify, opts) {
  const { db } = fastify

  fastify.post('/login', { schema: loginSchema }, async (request, reply) => {
    const { email, password } = request.body
    const user = db.users.find(u => u.email === email.toLowerCase())
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid email or password' })
    }
    const token = fastify.jwt.sign({ sub: user.id, username: user.username, role: user.role })
    return { token, expiresIn: 3600 }
  })

  fastify.post('/register', { schema: registerSchema }, async (request, reply) => {
    const { email, username, password, name = '' } = request.body
    const normalized = email.toLowerCase()
    if (db.users.some(u => u.email === normalized || u.username === username)) {
      return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Email or username already taken' })
    }
    const user = {
      id: db.nextId('users'),
      email: normalized,
      username,
      name,
      bio: '',
      role: 'user',
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString()
    }
    db.users.push(user)
    const token = fastify.jwt.sign({ sub: user.id, username: user.username, role: user.role })
    return reply.code(201).send({ user: publicUser(user), token })
  })
}
