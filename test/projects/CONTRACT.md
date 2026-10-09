# Test project contract

Each folder in test/projects/<id>/ is a small but realistic API project used to test routeman.

## Layout
- `package.json` with name, "type" (module/commonjs as the project prefers), the dependencies it imports
  (with real current version ranges), and a `start` script that runs the entry file.
- Do NOT create node_modules or lockfiles. All dependencies are installed once in test/projects/node_modules
  (Node resolution walks up from the project folder). TypeScript projects that must be compiled include a
  tsconfig.json; projects run through `tsx` just reference it in the start script.
- Several files: entry, app setup, routes/controllers, middleware, validation, services/in-memory data.
  Write it the way a typical developer of that framework writes production code - different projects should
  use different styles. Do not simplify the code for a tool; varied, real-world patterns are the point.
- `expected.json`: hand-written list of every HTTP endpoint the app serves:
  `[{ "method": "POST", "path": "/api/users/{id}", "auth": true, "body": ["name", "email"], "query": ["page"] }]`
  - path uses `{param}` with the parameter name exactly as written in the code (":userId" -> "{userId}")
  - auth: true when the endpoint needs a token/credentials, false otherwise
  - body: names of all top-level body fields the endpoint accepts (required and optional), or null when it takes no body;
    for file uploads include the file field name
  - query: names of query-string parameters it reads ([] if none)
  - add `"login": true` on the endpoint that returns the auth token
  - omit framework-internal routes (static files, 404 handlers, docs UIs)

## Runtime contract (only for projects marked RUNNABLE)
- Listen on `process.env.PORT` (default 3000). No databases or network services: keep data in memory.
- Seed data: a user `{ email: "admin@example.com", username: "admin", password: "Str0ngPassw0rd!", role: "admin" }`
  and at least one record in every collection, whose id is `1` (number or string "1"). If the project uses UUID ids
  seed one with id `3fa85f64-5717-4562-b3fc-2c963f66afa6`; for Mongo-style ObjectIds use `64b7f9c2e4b0a1a2b3c4d5e6`.
- Login: POST endpoint accepting the user's email (or username) + password, returning JSON with the JWT
  (any common shape: `{ token }`, `{ accessToken, refreshToken }`, `{ data: { token } }`...). JWT secret "test-secret".
- Protected endpoints require `Authorization: Bearer <jwt>` (unless the project deliberately uses another scheme -
  then document it in expected.json as `"scheme": "apikey"` etc).
- The seeded admin may call every endpoint (admin-only routes included).
- Invalid input -> 400 or 422 from the validation layer. Unknown ids -> 404. Never 5xx for valid input.
- Creating a record that already exists may return 409.
