import { Type } from '@sinclair/typebox'

export const Article = Type.Object({
  id: Type.Integer(),
  title: Type.String(),
  body: Type.String(),
  tags: Type.Array(Type.String()),
  published: Type.Boolean(),
  authorId: Type.Integer(),
  createdAt: Type.String(),
  updatedAt: Type.String()
})

export const ArticleParams = Type.Object({
  id: Type.Integer({ minimum: 1 })
})

export const ArticleListQuery = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 10 })),
  tag: Type.Optional(Type.String()),
  author: Type.Optional(Type.Integer())
})

export const CreateArticleBody = Type.Object({
  title: Type.String({ minLength: 3, maxLength: 200 }),
  body: Type.String({ minLength: 1 }),
  tags: Type.Optional(Type.Array(Type.String(), { maxItems: 10 })),
  published: Type.Optional(Type.Boolean())
}, { additionalProperties: false })

export const UpdateArticleBody = Type.Partial(CreateArticleBody, { additionalProperties: false, minProperties: 1 })

export const Comment = Type.Object({
  id: Type.Integer(),
  articleId: Type.Integer(),
  authorId: Type.Integer(),
  body: Type.String(),
  createdAt: Type.String()
})

export const CommentParams = Type.Object({
  articleId: Type.Integer({ minimum: 1 })
})

export const CommentItemParams = Type.Object({
  articleId: Type.Integer({ minimum: 1 }),
  commentId: Type.Integer({ minimum: 1 })
})

export const CommentListQuery = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
  order: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')]))
})

export const CreateCommentBody = Type.Object({
  body: Type.String({ minLength: 1, maxLength: 2000 })
}, { additionalProperties: false })
