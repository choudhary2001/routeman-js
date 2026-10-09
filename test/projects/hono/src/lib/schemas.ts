import { z } from 'zod'

export const idParam = z.object({
  id: z.coerce.number().int().positive(),
})

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const createUserSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(32),
  name: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(['admin', 'editor', 'reader']).default('reader'),
})

export const listUsersQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  role: z.enum(['admin', 'editor', 'reader']).optional(),
})

export const postSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1),
  tags: z.array(z.string()).default([]),
  published: z.boolean().default(false),
})

export type PostInput = z.infer<typeof postSchema>
