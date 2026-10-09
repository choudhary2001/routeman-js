export default defineEventHandler(async (event) => {
  const currentUser = await requireAuth(event)
  if (currentUser.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Admins only' })
  }

  const id = getRouterParam(event, 'id')
  const index = users.findIndex(u => u.id === id)
  if (index === -1) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' })
  }

  users.splice(index, 1)
  setResponseStatus(event, 204)
  return null
})
