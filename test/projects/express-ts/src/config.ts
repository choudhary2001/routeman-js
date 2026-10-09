export const config = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  jwt: {
    secret: process.env.JWT_SECRET ?? 'test-secret',
    expiresIn: '1h',
  },
  adminApiKey: process.env.ADMIN_API_KEY ?? 'test-api-key',
} as const;
