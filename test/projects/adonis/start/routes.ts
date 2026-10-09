/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
*/

import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const AuthController = () => import('#controllers/auth_controller')
const UsersController = () => import('#controllers/users_controller')
const PostsController = () => import('#controllers/posts_controller')

router.get('/health', async () => {
  return { status: 'ok' }
})

router.post('/api/auth/login', [AuthController, 'login'])
router.post('/api/auth/register', [AuthController, 'register'])
router.get('/api/auth/me', [AuthController, 'me'])

router
  .group(() => {
    router.get('/users', [UsersController, 'index'])
    router.post('/users', [UsersController, 'store'])
    router.get('/users/:id', [UsersController, 'show'])
    router.delete('/users/:id', [UsersController, 'destroy'])

    router.resource('posts', PostsController).apiOnly()
  })
  .prefix('/api')
  .use(middleware.auth())
