import { hashPassword } from './password.js'

export function createStore () {
  const now = () => new Date().toISOString()

  const users = [
    {
      id: 1,
      email: 'admin@example.com',
      username: 'admin',
      name: 'Site Admin',
      bio: '',
      role: 'admin',
      passwordHash: hashPassword('Str0ngPassw0rd!'),
      createdAt: now()
    }
  ]

  const articles = [
    {
      id: 1,
      title: 'Hello Fastify',
      body: 'Our first post.',
      tags: ['fastify', 'node'],
      published: true,
      authorId: 1,
      createdAt: now(),
      updatedAt: now()
    }
  ]

  const comments = [
    { id: 1, articleId: 1, authorId: 1, body: 'First!', createdAt: now() }
  ]

  const seq = { users: 1, articles: 1, comments: 1 }
  const nextId = (name) => ++seq[name]

  return { users, articles, comments, nextId }
}

export function publicUser (user) {
  const { passwordHash, ...rest } = user
  return rest
}
