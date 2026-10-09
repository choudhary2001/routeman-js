import { Elysia } from 'elysia'

const startedAt = Date.now()

export const health = new Elysia().get(
  '/health',
  () => ({ status: 'ok', uptimeMs: Date.now() - startedAt }),
  { detail: { summary: 'Liveness probe', tags: ['System'] } },
)
