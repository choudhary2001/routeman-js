export default defineEventHandler(async (event) => {
  const { email, password } = await readBody<{ email: string, password: string }>(event)

  const user = users.find(u => u.email === email && u.password === password)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid email or password' })
  }

  return {
    accessToken: await issueToken(user),
    user: toPublic(user),
  }
})
