import vine from '@vinejs/vine'

export const createPostValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(3).maxLength(255),
    content: vine.string().trim(),
    status: vine.enum(['draft', 'published']).optional(),
  })
)

export const updatePostValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(3).maxLength(255).optional(),
    content: vine.string().trim().optional(),
    status: vine.enum(['draft', 'published']).optional(),
  })
)
