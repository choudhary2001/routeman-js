export interface User {
  id: string
  name: string
  email: string
  password: string
  role: 'admin' | 'member'
  bio?: string
}

export const users: User[] = [
  { id: '1', name: 'admin', email: 'admin@example.com', password: 'Str0ngPassw0rd!', role: 'admin' },
]

export function toPublic(user: User) {
  const { password, ...rest } = user
  return rest
}

export function findUserOr404(id: string | undefined) {
  const user = users.find(u => u.id === id)
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' })
  }
  return user
}
