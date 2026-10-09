import { publicUser } from '../lib/store.js'
import { hashPassword } from '../lib/password.js'
import {
  userResponse,
  userIdParams,
  listUsersQuery,
  createUserBody,
  updateUserBody
} from '../schemas/users.js'

/**
 * User management. Mounted at /api/users from app.js.
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function usersRoutes (fastify) {
  const { db } = fastify

  fastify.get('/', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: listUsersQuery,
      response: {
        200: {
          type: 'object',
          properties: {
            data: { type: 'array', items: userResponse },
            page: { type: 'integer' },
            total: { type: 'integer' }
          }
        }
      }
    }
  }, async (request) => {
    const { page, limit, search } = request.query
    let rows = db.users
    if (search) {
      const needle = search.toLowerCase()
      rows = rows.filter(u => u.username.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle))
    }
    const start = (page - 1) * limit
    return { data: rows.slice(start, start + limit).map(publicUser), page, total: rows.length }
  })

  fastify.get('/me', {
    onRequest: [fastify.authenticate],
    schema: { response: { 200: userResponse } }
  }, async (request, reply) => {
    const user = db.users.find(u => u.id === request.user.sub)
    if (!user) return reply.code(404).send({ message: 'User not found' })
    return publicUser(user)
  })

  fastify.get('/:id', {
    onRequest: [fastify.authenticate],
    schema: { params: userIdParams, response: { 200: userResponse } }
  }, async (request, reply) => {
    const user = db.users.find(u => u.id === request.params.id)
    if (!user) return reply.code(404).send({ message: 'User not found' })
    return publicUser(user)
  })

  fastify.post('/', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    schema: { body: createUserBody, response: { 201: userResponse } }
  }, async (request, reply) => {
    const { email, username, password, name = '', role = 'user' } = request.body
    if (db.users.some(u => u.email === email || u.username === username)) {
      return reply.code(409).send({ message: 'User already exists' })
    }
    const user = {
      id: db.nextId('users'),
      email,
      username,
      name,
      bio: '',
      role,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString()
    }
    db.users.push(user)
    return reply.code(201).send(publicUser(user))
  })

  fastify.route({
    method: 'PATCH',
    url: '/:id',
    onRequest: [fastify.authenticate],
    schema: {
      params: userIdParams,
      body: updateUserBody,
      response: { 200: userResponse }
    },
    handler: async (request, reply) => {
      const { id } = request.params
      if (request.user.sub !== id && request.user.role !== 'admin') {
        return reply.code(403).send({ message: 'You can only update your own profile' })
      }
      const user = db.users.find(u => u.id === id)
      if (!user) return reply.code(404).send({ message: 'User not found' })
      if (request.body.email && db.users.some(u => u.email === request.body.email && u.id !== id)) {
        return reply.code(409).send({ message: 'Email already in use' })
      }
      Object.assign(user, request.body)
      return publicUser(user)
    }
  })

  fastify.delete('/:id', {
    onRequest: [fastify.authenticate, fastify.requireAdmin],
    schema: { params: userIdParams }
  }, async (request, reply) => {
    const idx = db.users.findIndex(u => u.id === request.params.id)
    if (idx === -1) return reply.code(404).send({ message: 'User not found' })
    db.users.splice(idx, 1)
    return reply.code(204).send()
  })
}
