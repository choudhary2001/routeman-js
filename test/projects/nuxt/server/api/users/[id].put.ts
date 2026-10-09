import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'

interface UpdateUserBody {
  name?: string
  email?: string
  bio?: string
}

export default defineEventHandler(async (event) => {
  await requireAuth(event)

  const id = getRouterParam(event, 'id')
  const user = findUserOr404(id)

  const body = await readBody<UpdateUserBody>(event)
  if (body.email && !body.email.includes('@')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid email' })
  }

  user.name = body.name ?? user.name
  user.email = body.email ?? user.email
  user.bio = body.bio ?? user.bio

  return toPublic(user)
})
