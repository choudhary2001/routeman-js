import type { H3Event } from 'h3'
import { SignJWT, jwtVerify } from 'jose'

const encoder = new TextEncoder()

export interface AuthUser {
  id: string
  email: string
  role: string
}

export async function issueToken(user: AuthUser) {
  const { jwtSecret } = useRuntimeConfig()
  return await new SignJWT({ email: user.email, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setExpirationTime('1h')
    .sign(encoder.encode(jwtSecret))
}

export async function requireAuth(event: H3Event): Promise<AuthUser> {
  const authorization = getHeader(event, 'authorization')
  if (!authorization || !authorization.startsWith('Bearer ')) {
    throw createError({ statusCode: 401, statusMessage: 'Missing bearer token' })
  }

  try {
    const { jwtSecret } = useRuntimeConfig()
    const { payload } = await jwtVerify(authorization.slice(7), encoder.encode(jwtSecret))
    const user = { id: payload.sub!, email: payload.email as string, role: payload.role as string }
    event.context.user = user
    return user
  }
  catch {
    throw createError({ statusCode: 401, statusMessage: 'Invalid token' })
  }
}
