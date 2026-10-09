import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import type { AppEnv } from './lib/types'
import { jwtAuth } from './middleware/auth'
import auth from './routes/auth'
import health from './routes/health'
import posts from './routes/posts'
import users from './routes/users'

const app = new Hono<AppEnv>()

app.use(logger())
app.use('*', secureHeaders())
app.use('/api/*', cors())

// Everything under users and posts requires a valid bearer token.
app.use('/api/users/*', jwtAuth)
app.use('/api/posts/*', jwtAuth)

app.route('/health', health)

const api = new Hono<AppEnv>()
  .basePath('/api')
  .route('/auth', auth)
  .route('/users', users)
  .route('/posts', posts)

app.route('/', api)

app.notFound((c) => c.json({ error: 'Not Found' }, 404))

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse()
  }
  console.error(err)
  return c.json({ error: 'Internal Server Error' }, 500)
})

export type AppType = typeof api
export default app
