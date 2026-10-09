import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import AutoLoad from '@fastify/autoload'

import authPlugin from './plugins/auth.js'
import dbPlugin from './plugins/db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default async function buildApp (opts = {}) {
  const fastify = Fastify({
    ajv: { customOptions: { allErrors: true } },
    ...opts
  })

  // Shared plugins (wrapped with fastify-plugin, so decorators leak to every route)
  await fastify.register(dbPlugin)
  await fastify.register(authPlugin, {
    secret: process.env.JWT_SECRET || 'test-secret'
  })

  fastify.get('/health', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            uptime: { type: 'number' }
          }
        }
      }
    }
  }, async () => ({ status: 'ok', uptime: process.uptime() }))

  // Users live in their own module, mounted manually
  fastify.register(import('./routes/users.js'), { prefix: '/api/users' })

  // Everything under routes/api is picked up automatically:
  //   routes/api/auth/index.js                         -> /api/auth
  //   routes/api/articles/routes.js                    -> /api/articles
  //   routes/api/articles/_articleId/comments/index.js -> /api/articles/:articleId/comments
  fastify.register(AutoLoad, {
    dir: join(__dirname, 'routes', 'api'),
    routeParams: true,
    options: { prefix: '/api' }
  })

  fastify.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ statusCode: 404, error: 'Not Found', message: `Route ${request.method} ${request.url} not found` })
  })

  return fastify
}
