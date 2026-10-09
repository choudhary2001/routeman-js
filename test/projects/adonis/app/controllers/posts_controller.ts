import type { HttpContext } from '@adonisjs/core/http'
import Post from '#models/post'
import { createPostValidator, updatePostValidator } from '#validators/post'

export default class PostsController {
  async index({ request }: HttpContext) {
    const page = request.input('page', 1)
    const perPage = request.input('perPage', 10)
    const status = request.input('status')

    return Post.query()
      .if(status, (query) => query.where('status', status))
      .preload('author')
      .paginate(page, perPage)
  }

  async store({ request, auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const data = await request.validateUsing(createPostValidator)
    const post = await user.related('posts').create(data)
    return response.created(post)
  }

  async show({ params }: HttpContext) {
    const post = await Post.findOrFail(params.id)
    await post.load('author')
    return post
  }

  async update({ params, request }: HttpContext) {
    const post = await Post.findOrFail(params.id)
    const data = await request.validateUsing(updatePostValidator)
    return post.merge(data).save()
  }

  async destroy({ params, response }: HttpContext) {
    const post = await Post.findOrFail(params.id)
    await post.delete()
    return response.noContent()
  }
}
