import fp from 'fastify-plugin'
import { createStore } from '../lib/store.js'

export default fp(async function dbPlugin (fastify) {
  fastify.decorate('db', createStore())
}, { name: 'db' })
