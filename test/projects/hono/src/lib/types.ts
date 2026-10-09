export type Role = 'admin' | 'editor' | 'reader'

export interface User {
  id: number
  email: string
  username: string
  name: string
  password: string
  role: Role
  avatarUrl: string | null
  createdAt: string
}

export interface Post {
  id: number
  title: string
  body: string
  tags: string[]
  published: boolean
  authorId: number
  createdAt: string
  updatedAt: string
}

export type TokenPayload = {
  sub: number
  role: Role
  exp: number
}

export type AppEnv = {
  Variables: {
    jwtPayload: TokenPayload
  }
}
