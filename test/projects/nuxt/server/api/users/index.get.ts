export default defineEventHandler((event) => {
  const { page = '1', perPage = '20', role } = getQuery(event)

  const filtered = role ? users.filter(u => u.role === role) : users
  const p = Number(page)
  const size = Number(perPage)

  return {
    items: filtered.slice((p - 1) * size, p * size).map(toPublic),
    total: filtered.length,
  }
})
