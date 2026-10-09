import type { Post, User } from './types'

const now = () => new Date().toISOString()

export const db = {
  users: [
    {
      id: 1,
      email: 'admin@example.com',
      username: 'admin',
      name: 'Administrator',
      password: 'Str0ngPassw0rd!',
      role: 'admin',
      avatarUrl: null,
      createdAt: now(),
    },
  ] as User[],
  posts: [
    {
      id: 1,
      title: 'Hello Hono',
      body: 'Our very first post, served from the edge (well, from Node).',
      tags: ['announcement'],
      published: true,
      authorId: 1,
      createdAt: now(),
      updatedAt: now(),
    },
  ] as Post[],
}

let seq = { users: 1, posts: 1 }

export function nextId(table: keyof typeof seq): number {
  seq[table] += 1
  return seq[table]
}

export function toPublicUser({ password: _password, ...user }: User) {
  return user
}
