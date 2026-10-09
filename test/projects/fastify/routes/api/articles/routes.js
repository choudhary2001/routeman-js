import { Type } from '@sinclair/typebox'
import {
  Article,
  ArticleParams,
  ArticleListQuery,
  CreateArticleBody,
  UpdateArticleBody
} from '../../../schemas/articles.js'

export default async function articleRoutes (fastify) {
  const { db } = fastify

  const findArticle = (id) => db.articles.find(a => a.id === id)
  const canEdit = (user, article) => user.role === 'admin' || user.sub === article.authorId

  fastify.get('/', {
    schema: {
      querystring: ArticleListQuery,
      response: {
        200: Type.Object({
          articles: Type.Array(Article),
          count: Type.Integer()
        })
      }
    }
  }, async (request) => {
    const { page = 1, limit = 10, tag, author } = request.query
    let rows = db.articles.filter(a => a.published)
    if (tag) rows = rows.filter(a => a.tags.includes(tag))
    if (author !== undefined) rows = rows.filter(a => a.authorId === author)
    const offset = (page - 1) * limit
    return { articles: rows.slice(offset, offset + limit), count: rows.length }
  })

  fastify.get('/:id', {
    schema: { params: ArticleParams, response: { 200: Article } }
  }, async (request, reply) => {
    const article = findArticle(request.params.id)
    if (!article) return reply.code(404).send({ message: 'Article not found' })
    return article
  })

  fastify.post('/', {
    onRequest: [fastify.authenticate],
    schema: { body: CreateArticleBody, response: { 201: Article } }
  }, async (request, reply) => {
    const { title, body, tags = [], published = false } = request.body
    const ts = new Date().toISOString()
    const article = {
      id: db.nextId('articles'),
      title,
      body,
      tags,
      published,
      authorId: request.user.sub,
      createdAt: ts,
      updatedAt: ts
    }
    db.articles.push(article)
    return reply.code(201).send(article)
  })

  fastify.put('/:id', {
    onRequest: [fastify.authenticate],
    schema: { params: ArticleParams, body: UpdateArticleBody, response: { 200: Article } }
  }, async (request, reply) => {
    const article = findArticle(request.params.id)
    if (!article) return reply.code(404).send({ message: 'Article not found' })
    if (!canEdit(request.user, article)) return reply.code(403).send({ message: 'Not your article' })
    Object.assign(article, request.body, { updatedAt: new Date().toISOString() })
    return article
  })

  fastify.delete('/:id', {
    onRequest: [fastify.authenticate],
    schema: { params: ArticleParams }
  }, async (request, reply) => {
    const article = findArticle(request.params.id)
    if (!article) return reply.code(404).send({ message: 'Article not found' })
    if (!canEdit(request.user, article)) return reply.code(403).send({ message: 'Not your article' })
    db.articles.splice(db.articles.indexOf(article), 1)
    for (let i = db.comments.length - 1; i >= 0; i--) {
      if (db.comments[i].articleId === article.id) db.comments.splice(i, 1)
    }
    return reply.code(204).send()
  })
}
