# routeman

**Generate a complete Postman collection from your Node.js, Bun or Deno API with one command.
Works with Express, Fastify, NestJS, Koa, Hono, Elysia, Hapi, Next.js, Nuxt, SvelteKit, AdonisJS and more.
You don't need OpenAPI, Swagger decorators or a running server.**

```bash
npx routeman-cli        # or: pnpm dlx routeman-cli · yarn dlx routeman-cli · bunx routeman-cli · deno run -A npm:routeman-cli
```

```
✓ express: 24 requests (9 GET, 8 POST, 3 PUT, 2 PATCH, 2 DELETE)
✓ auth: bearer (login: POST /api/v1/auth/login)
✓ wrote postman/shop-api.postman_collection.json
✓ wrote postman/shop-api.local.postman_environment.json
  done in 0.08s - import the files in Postman (File → Import)
```

routeman reads your source code the way the framework would wire it up. It follows imports, routers, `app.use()`
mounts, prefixes, plugins, controllers and decorators. **It never runs your code**, so it doesn't need a database,
secrets or a build step, and it can't trigger side effects. You get every endpoint with its methods, path variables,
query parameters and request bodies, all filled with example values that pass your validation. You also get
authentication setup and a login request that saves the token for you.

Made by [Shwastik Tech Solutions Pvt Ltd](https://swastik.ai). Also available for Python (Django, Flask, FastAPI):
[`pip install routeman`](https://pypi.org/project/routeman/).

---

## Install

| Package manager | One-off run | Install as a dev dependency |
|---|---|---|
| npm | `npx routeman-cli` | `npm i -D routeman-cli` |
| pnpm | `pnpm dlx routeman-cli` | `pnpm add -D routeman-cli` |
| yarn | `yarn dlx routeman-cli` | `yarn add -D routeman-cli` |
| bun | `bunx routeman-cli` | `bun add -d routeman-cli` |
| deno | `deno run -A npm:routeman-cli` | - |

Once installed, the command is `routeman` (for example `npx routeman routes`, or a `"postman": "routeman"` script).

Requires Node.js 18.3 or newer (or Bun or Deno). **Zero dependencies**: the package is about 600 kB and installs
in about a second.

## Supported frameworks

| Framework | What routeman understands |
|---|---|
| **Express 4 / 5** | `Router()`, `app.use(prefix, router)`, `router.route().get().post()`, sub-apps, router factories, routes registered in loops or loaded with `fs.readdirSync`/glob, regex-free paths, `*splat` |
| **Fastify 4 / 5** | `register(plugin, { prefix })`, `@fastify/autoload` (folder prefixes, `_param` dirs), `fastify-plugin`, `decorate`, `addHook`, `route({...})`, JSON Schema and TypeBox schemas |
| **NestJS** | controllers, global prefix, URI versioning (`@Version`), `RouterModule`, DTOs (class-validator + `@ApiProperty`), `PartialType`/`PickType`/`OmitType`, pipes, `FileInterceptor`, guards incl. global `APP_GUARD` + `@Public()` |
| **Koa** | `@koa/router` / `koa-router`: nesting, `prefix`, named routes, `koa-mount` |
| **Hono** | sub-apps, `route()`, `basePath()`, `on()`, chained routes, path-scoped middleware, `@hono/zod-validator`, `@hono/zod-openapi` |
| **Elysia** (Bun) | `group`, `guard`, plugins, `prefix`, `t.*` schemas, `.model()` references, `beforeHandle` / `derive` auth |
| **Hapi** | `server.route`, plugins with `routes.prefix`, Joi `validate`, auth strategies, `auth: false` |
| **Next.js** | App Router `route.ts` (incl. route groups and dynamic segments), Pages Router `pages/api`, `next-connect`, `basePath` |
| **Nuxt / Nitro / h3** | `server/api`, `server/routes`, `[id].get.ts` naming, `readBody`, `getQuery`, `readValidatedBody`, auto-imported utils |
| **SvelteKit, Astro, Remix / React Router** | `+server.ts`, API endpoints, resource routes (`loader` / `action`) |
| **AdonisJS 6** | `router.group().prefix().use()`, `resource().apiOnly()`, lazy controllers, VineJS validators, `request.input()` |
| **Decorator frameworks** | routing-controllers, tsoa, inversify-express-utils, LoopBack 4 |
| **More** | Restify, Polka, tinyhttp, ultimate-express, hyper-express, itty-router, Feathers services, Oak (Deno), `Bun.serve({ routes })`, `Deno.serve`, plain `node:http` servers that compare `req.url` / `req.method` |
| **Anything else** | `--openapi <file or URL>` builds the collection from an OpenAPI 3 / Swagger 2 document (JSON or YAML) |

## What you get

| | |
|---|---|
| **Every route** | Across all files and mounts, with the full path (prefixes, versions, global prefix). Static files and 404 catch-alls are left out. |
| **Request bodies** | JSON, `x-www-form-urlencoded` or `multipart/form-data` (file uploads become Postman file pickers). Example values pass validation: they respect enums, min/max, lengths, regex patterns and field names (`email` gets `user@example.com`). |
| **Where bodies come from** | zod (v3/v4), Joi / celebrate, yup, TypeBox / Elysia `t`, valibot, VineJS, express-validator, JSON Schema, class-validator DTOs, TypeScript types (`Request<{}, {}, Body>`, `req.body as Dto`), Mongoose / Prisma / Sequelize / TypeORM models when the body goes straight to the database, and finally the handler code itself (`const { email, password } = req.body`, `c.req.json()`, `await request.json()`, `readBody(event)`...). |
| **Query parameters** | From schemas or code (`req.query.page`, `searchParams.get('q')`, `c.req.query('q')`, `@Query('page')`). Optional ones are added but switched off. |
| **Path variables** | `{{userId}}`, `{{productId}}`... stored in the environment and named after the resource. They are typed from the route (`:id(\\d+)`, `ParseIntPipe`, `ParseUUIDPipe`, schemas), and use Mongo ObjectIds when the project uses Mongoose. |
| **Authentication** | Detected automatically: Bearer/JWT, `Token` prefix, API key header, custom token header, Basic or session. The detection comes from middleware, guards, hooks and the code (`jwt.verify`, `passport.authenticate('jwt')`, `request.jwtVerify()`, reading `Authorization`...). Public routes get *No Auth*; routes with a different scheme (an `x-api-key` admin router) get their own auth. |
| **Login script** | The login request saves `access_token` / `refresh_token` from its response, wherever they are in the JSON. |
| **Environments** | One per server (local, staging, production…). The local port comes from your code (`app.listen(4000)`, `PORT` in `.env`). |
| **Smoke test** | Every request checks that the response is not a 5xx, so the Collection Runner or Newman can smoke-test the whole API. |
| **Docs** | Request names and descriptions come from JSDoc / `// @desc` comments, `@ApiOperation`, Fastify `schema.summary`, Elysia `detail`, plus a table of body and query fields. |

## Commands

```bash
routeman                       # same as `routeman generate`
routeman generate --stdout     # print the collection instead of writing files
routeman routes                # list what routeman found (method, path, auth, body fields)
routeman routes --json         # machine-readable
routeman init                  # save the project details in routeman.config.json (asks a few questions)
routeman --version
```

| Option | Meaning |
|---|---|
| `-C, --project DIR` | project folder (default: current folder) |
| `-f, --framework NAME` | force a framework (`express`, `nest`, `fastify`, ...) instead of detecting it |
| `-a, --entry FILE` | entry file, e.g. `src/server.ts` (repeatable; detected from `package.json` scripts/main) |
| `-n, --name` | collection name |
| `-o, --output DIR` | output folder (default `postman`) |
| `-b, --base-url URL` | base URL of the `local` environment |
| `-e, --env NAME=URL` | add an environment, e.g. `-e production=https://api.example.com` (repeatable) |
| `-x, --exclude REGEX` | leave out paths, e.g. `-x '^/internal/'` (repeatable) |
| `--auth TYPE` | force `none`, `bearer`, `token`, `basic`, `apikey`, `header` or `session` |
| `--login PATH` | the POST route whose response contains the token |
| `--openapi SRC` | build from an OpenAPI/Swagger file or URL instead of source code |
| `--env-file FILE` | `.env` values the code reads (default: `.env`, then `.env.example`) |

## Configuration file

`routeman init` writes `routeman.config.json`. You can put the same object under `"routeman"` in `package.json`
instead:

```json
{
  "name": "Shop API",
  "framework": "auto",
  "entry": ["src/server.ts"],
  "output": "postman",
  "environments": {
    "local": "http://localhost:3000",
    "production": "https://api.example.com"
  },
  "exclude": ["^/internal/"],
  "auth": { "type": "auto", "login": "/api/auth/login" }
}
```

Command-line options override the file.

## Programmatic API

```js
import { generate, write } from 'routeman-cli';

const result = await generate({ project: '.', environments: { staging: 'https://staging.example.com' } });
console.log(result.api.routes.length, 'routes');
write(result); // or use result.collection / result.environments directly
```

Types are included (`index.d.ts`).

## How it works

routeman parses your files with a vendored copy of the Babel parser (JavaScript, TypeScript, JSX, decorators). It
then runs a small *abstract interpreter* over them. This interpreter evaluates imports (ESM, CommonJS, tsconfig
`paths`, `package.json` `imports`, Deno import maps), string constants, `process.env` values from `.env`, function
calls, classes and loops over static arrays. It records every router and route the framework would register. It
never executes anything outside your source files, never touches the network or a database, and has a hard step
budget, so it always finishes fast. Each handler is then analysed with symbolic request values to see what it reads.

It is fast and light: about 3,000 routes in 0.8 s. Memory use stays flat over repeated runs in the same process,
because there are no global caches, timers or listeners.

## Tips

* Set `username` / `password` in the environment, run **Login** first, and the token is used everywhere.
* Set the `{{…Id}}` variables from list responses, or edit them in the environment.
* Regenerate whenever your API changes. Collection and request ids are stable, so importing again replaces the
  previous version.
* If routes are missing, run `routeman routes` and check the warnings. Usually the entry file needs to be passed
  with `--entry`, or a route path is built at runtime from data routeman can't see.

## Testing

`npm test` runs the unit tests and checks 17 realistic sample projects (one per framework) against hand-written
expectations. `npm run test:e2e <project>` starts the real server of a sample project and sends every generated
request to it. Every request must be accepted: no 5xx, no 404, no validation error and no auth failure.

## License

MIT © [Shwastik Tech Solutions Pvt Ltd](https://swastik.ai)
