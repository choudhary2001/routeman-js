import { z } from 'zod'

const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['admin', 'member']).optional(),
})

export default defineEventHandler(async (event) => {
  await requireAuth(event)

  const body = await readValidatedBody(event, createUserSchema.parse)

  if (users.some(u => u.email === body.email)) {
    throw createError({ statusCode: 409, statusMessage: 'Email already registered' })
  }

  const user = { id: String(users.length + 1), role: 'member' as const, ...body }
  users.push(user)

  setResponseStatus(event, 201)
  return toPublic(user)
})
