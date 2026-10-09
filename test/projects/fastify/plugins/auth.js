import fp from 'fastify-plugin'
import fastifyJwt from '@fastify/jwt'

async function authPlugin (fastify, opts) {
  fastify.register(fastifyJwt, {
    secret: opts.secret,
    sign: { expiresIn: '1h' }
  })

  fastify.decorate('authenticate', async (request, reply) => {
    await request.jwtVerify()
  })

  fastify.decorate('requireAdmin', async (request, reply) => {
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin role required' })
    }
  })
}

export default fp(authPlugin, {
  name: 'auth',
  fastify: '5.x'
})
