export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  return toPublic(findUserOr404(id))
})
