export const env = {
  PORT: Number(process.env.PORT ?? 3000),
  JWT_SECRET: process.env.JWT_SECRET ?? 'test-secret',
  JWT_TTL_SECONDS: 60 * 60 * 24,
}
