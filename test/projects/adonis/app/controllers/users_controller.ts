import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { createUserValidator } from '#validators/user'

export default class UsersController {
  /**
   * Paginated list of users
   */
  async index({ request }: HttpContext) {
    const page = request.input('page', 1)
    const search = request.input('search')

    const query = User.query().orderBy('id', 'asc')
    if (search) {
      query.whereILike('email', `%${search}%`)
    }

    return query.paginate(page, 20)
  }

  async store({ request, response }: HttpContext) {
    const payload = await request.validateUsing(createUserValidator)
    const user = await User.create(payload)
    return response.created(user)
  }

  async show({ params }: HttpContext) {
    return User.findOrFail(params.id)
  }

  async destroy({ params, response }: HttpContext) {
    const user = await User.findOrFail(params.id)
    await user.delete()
    return response.noContent()
  }
}
