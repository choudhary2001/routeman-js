# Changelog

## 0.1.0 - 2026-10-09

First release.

- `routeman generate`, `routeman routes`, `routeman init`.
- Static analysis (the project's code is never run) for Express 4/5, Fastify (plugins, autoload, JSON Schema/TypeBox),
  Koa / @koa/router, Hono (incl. zod-openapi), Elysia, NestJS, Hapi, Restify, Polka, tinyhttp, hyper-express,
  ultimate-express, itty-router, h3, Feathers, AdonisJS, Oak, routing-controllers, tsoa, inversify-express-utils,
  LoopBack 4, `Bun.serve`, `Deno.serve`, `node:http`, and file routing in Next.js, Nuxt/Nitro, SvelteKit, Astro, Remix.
- Request bodies from zod, Joi/celebrate, yup, TypeBox, valibot, VineJS, express-validator, JSON Schema,
  class-validator DTOs, TypeScript types, Mongoose/Prisma/Sequelize/TypeORM models, or the handler code.
- Auth detection (Bearer/JWT, token, API key, custom header, Basic, session) with a login request that stores the token.
- `--openapi` to build from an OpenAPI 3 / Swagger 2 file or URL (JSON or YAML).
- Zero runtime dependencies (the Babel parser is vendored).
