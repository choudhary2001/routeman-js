import buildApp from './app.js'

const port = Number(process.env.PORT) || 3000
const host = process.env.HOST || '0.0.0.0'

const app = await buildApp({
  logger: { level: process.env.LOG_LEVEL || 'info' }
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down')
    await app.close()
    process.exit(0)
  })
}

try {
  await app.listen({ port, host })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
