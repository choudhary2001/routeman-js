import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { db, nextId } from '../lib/db'
import { idParam, postSchema } from '../lib/schemas'
import type { AppEnv, Post } from '../lib/types'

const posts = new Hono<AppEnv>()
  .get('/', (c) => {
    const q = c.req.query('q')?.toLowerCase()
    const tag = c.req.query('tag')
    const authorId = c.req.query('authorId')

    let result = db.posts
    if (q) result = result.filter((p) => p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q))
    if (tag) result = result.filter((p) => p.tags.includes(tag))
    if (authorId) result = result.filter((p) => p.authorId === Number(authorId))

    return c.json({ data: result, total: result.length })
  })
  .post('/', zValidator('json', postSchema), (c) => {
    const input = c.req.valid('json')
    const timestamp = new Date().toISOString()
    const post: Post = {
      ...input,
      id: nextId('posts'),
      authorId: c.get('jwtPayload').sub,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    db.posts.push(post)
    return c.json(post, 201)
  })
  .get('/:id', zValidator('param', idParam), (c) => {
    const { id } = c.req.valid('param')
    const post = db.posts.find((p) => p.id === id)
    if (!post) return c.json({ error: 'Post not found' }, 404)
    return c.json(post)
  })
  .put('/:id', zValidator('param', idParam), zValidator('json', postSchema), (c) => {
    const { id } = c.req.valid('param')
    const post = db.posts.find((p) => p.id === id)
    if (!post) return c.json({ error: 'Post not found' }, 404)

    const { sub, role } = c.get('jwtPayload')
    if (post.authorId !== sub && role !== 'admin') {
      return c.json({ error: 'You can only edit your own posts' }, 403)
    }

    Object.assign(post, c.req.valid('json'), { updatedAt: new Date().toISOString() })
    return c.json(post)
  })
  .delete('/:id', zValidator('param', idParam), (c) => {
    const { id } = c.req.valid('param')
    const index = db.posts.findIndex((p) => p.id === id)
    if (index === -1) return c.json({ error: 'Post not found' }, 404)

    const { sub, role } = c.get('jwtPayload')
    if (db.posts[index].authorId !== sub && role !== 'admin') {
      return c.json({ error: 'You can only delete your own posts' }, 403)
    }

    db.posts.splice(index, 1)
    return c.body(null, 204)
  })

export default posts
