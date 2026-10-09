export const userResponse = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    email: { type: 'string' },
    username: { type: 'string' },
    name: { type: 'string' },
    bio: { type: 'string' },
    role: { type: 'string' },
    createdAt: { type: 'string' }
  }
}

export const userIdParams = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'integer', minimum: 1 }
  }
}

export const listUsersQuery = {
  type: 'object',
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    search: { type: 'string', maxLength: 100 }
  },
  additionalProperties: false
}

export const createUserBody = {
  type: 'object',
  required: ['email', 'username', 'password'],
  properties: {
    email: { type: 'string', format: 'email' },
    username: { type: 'string', minLength: 3, maxLength: 30 },
    password: { type: 'string', minLength: 8 },
    name: { type: 'string', maxLength: 100 },
    role: { type: 'string', enum: ['user', 'editor', 'admin'] }
  },
  additionalProperties: false
}

export const updateUserBody = {
  type: 'object',
  minProperties: 1,
  properties: {
    email: { type: 'string', format: 'email' },
    name: { type: 'string', maxLength: 100 },
    bio: { type: 'string', maxLength: 500 }
  },
  additionalProperties: false
}
