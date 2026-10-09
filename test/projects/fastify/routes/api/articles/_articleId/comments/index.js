import { Type } from '@sinclair/typebox'
import {
  Comment,
  CommentParams,
  CommentItemParams,
  CommentListQuery,
  CreateCommentBody
} from '../../../../../schemas/articles.js'

/**
 * Comments for a single article: /api/articles/:articleId/comments
 * Every route in this plugin requires a valid JWT.
 */
export default async function commentRoutes (fastify) {
  const { db } = fastify

  fastify.addHook('onRequest', fastify.authenticate)

  // Make sure the parent article exists before any handler runs
  fastify.addHook('preHandler', async (request, reply) => {
    const article = db.articles.find(a => a.id === request.params.articleId)
    if (!article) return reply.code(404).send({ message: 'Article not found' })
    request.article = article
  })

  fastify.get('/', {
    schema: {
      params: CommentParams,
      querystring: CommentListQuery,
      response: { 200: Type.Array(Comment) }
    }
  }, async (request) => {
    const { limit = 50, order = 'asc' } = request.query
    const rows = db.comments
      .filter(c => c.articleId === request.article.id)
      .sort((a, b) => order === 'asc' ? a.id - b.id : b.id - a.id)
    return rows.slice(0, limit)
  })

  fastify.post('/', {
    schema: {
      params: CommentParams,
      body: CreateCommentBody,
      response: { 201: Comment }
    }
  }, async (request, reply) => {
    const comment = {
      id: db.nextId('comments'),
      articleId: request.article.id,
      authorId: request.user.sub,
      body: request.body.body,
      createdAt: new Date().toISOString()
    }
    db.comments.push(comment)
    return reply.code(201).send(comment)
  })

  fastify.delete('/:commentId', {
    schema: { params: CommentItemParams }
  }, async (request, reply) => {
    const { articleId, commentId } = request.params
    const idx = db.comments.findIndex(c => c.id === commentId && c.articleId === articleId)
    if (idx === -1) return reply.code(404).send({ message: 'Comment not found' })
    const comment = db.comments[idx]
    if (comment.authorId !== request.user.sub && request.user.role !== 'admin') {
      return reply.code(403).send({ message: 'Not your comment' })
    }
    db.comments.splice(idx, 1)
    return reply.code(204).send()
  })
}
