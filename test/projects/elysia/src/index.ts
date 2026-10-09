import { Elysia } from 'elysia'
import { health } from './modules/health'
import { auth } from './modules/auth'
import { usersModule } from './modules/users'
import { productsModule } from './modules/products'
import { ordersModule } from './modules/orders'

const app = new Elysia()
  .onError(({ code, error, set }) => {
    if (code === 'VALIDATION') {
      set.status = 422
      return { message: 'Validation failed', details: error.message }
    }
  })
  .use(health)
  .group('/api', (app) => app.use(auth).use(usersModule).use(productsModule).use(ordersModule))
  .listen(Number(process.env.PORT ?? 3000))

console.log(`Shop API running at http://${app.server?.hostname}:${app.server?.port}`)

export type App = typeof app
