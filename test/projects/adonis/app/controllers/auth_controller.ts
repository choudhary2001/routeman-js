import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { loginValidator } from '#validators/auth'
import { createUserValidator } from '#validators/user'

export default class AuthController {
  async login({ request }: HttpContext) {
    const { email, password } = await request.validateUsing(loginValidator)
    const user = await User.verifyCredentials(email, password)
    const token = await User.accessTokens.create(user)

    return {
      type: 'bearer',
      token: token.value!.release(),
    }
  }

  async register({ request, response }: HttpContext) {
    const payload = await request.validateUsing(createUserValidator)
    const user = await User.create(payload)
    return response.created(user)
  }

  async me({ auth }: HttpContext) {
    const user = await auth.use('api').authenticate()
    return user
  }
}
