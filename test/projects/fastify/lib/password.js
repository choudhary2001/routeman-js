import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'

export function hashPassword (plain) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(plain, salt, 32).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword (plain, stored) {
  const [salt, hash] = stored.split(':')
  const candidate = scryptSync(plain, salt, 32)
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'))
}
