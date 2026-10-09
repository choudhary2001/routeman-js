import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseYaml } from '../src/yaml.js';
import { fromOpenapi } from '../src/openapi.js';
import { example, pathExample } from '../src/examples.js';
import { field, NONE } from '../src/model.js';
import { normalizePath, routeName } from '../src/analyze/routes.js';
import { variableNames } from '../src/naming.js';
import { Writer, uid } from '../src/postman.js';
import { api as newApi, route as newRoute, body as newBody } from '../src/model.js';
import { VERSION } from '../src/version.js';

test('version matches package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(VERSION, pkg.version);
});

test('yaml: mappings, sequences, scalars, block text, flow, anchors', () => {
  const doc = parseYaml(`
openapi: 3.0.0
info:
  title: "Pet API"   # comment
  version: 1.0
paths:
  /pets/{id}:
    get:
      tags: [pets, 'read']
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: integer }
      description: |
        Line one
        Line two
defaults: &d
  limit: 10
other:
  <<: *d
  flag: false
`);
  assert.equal(doc.info.title, 'Pet API');
  assert.equal(doc.info.version, 1);
  const get = doc.paths['/pets/{id}'].get;
  assert.deepEqual(get.tags, ['pets', 'read']);
  assert.equal(get.parameters[0].name, 'id');
  assert.equal(get.parameters[0].required, true);
  assert.deepEqual(get.parameters[0].schema, { type: 'integer' });
  assert.equal(get.description, 'Line one\nLine two\n');
  assert.deepEqual(doc.other, { limit: 10, flag: false });
});

test('openapi: bodies, params, security, login', () => {
  const a = fromOpenapi({
    openapi: '3.0.0',
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      schemas: { User: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' }, age: { type: 'integer', minimum: 18 } } } },
    },
    security: [{ bearer: [] }],
    paths: {
      '/auth/login': { post: { security: [], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, password: { type: 'string' } } } } } } } },
      '/users/{id}': { put: { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } } },
    },
  });
  assert.equal(a.auth, 'bearer');
  const put = a.routes.find((r) => r.method === 'PUT');
  assert.equal(put.body.fields[0].type, 'email');
  assert.equal(put.body.fields[0].required, true);
  assert.ok(example(put.body.fields[1]) >= 18);
  assert.equal(a.routes.find((r) => r.path === '/auth/login').auth, 'none');
});

test('examples respect names, types and limits', () => {
  assert.equal(example(field('email', 'any')), 'user@example.com');
  assert.equal(example(field('refreshToken', 'string')), '{{refresh_token}}');
  assert.equal(example(field('firstName', 'any')), 'John');
  assert.equal(example(field('page', 'any')), 1);
  assert.equal(example(field('limit', 'integer')), 10);
  assert.equal(example(field('code', 'string', { limits: { minLength: 8 } })).length, 8);
  assert.equal(example(field('price', 'number', { limits: { exclusiveMin: 0 } })) > 0, true);
  assert.equal(example(field('status', 'string', { choices: ['open', 'closed'] })), 'open');
  assert.equal(pathExample({ name: 'id', type: 'string', example: NONE }, 'objectid'), '64b7f9c2e4b0a1a2b3c4d5e6');
});

test('path syntax of every framework normalises to {param}', () => {
  assert.deepEqual(normalizePath('/users/:id(\\d+)'), { path: '/users/{id}', params: [{ name: 'id', type: 'integer' }] });
  assert.equal(normalizePath('/posts/:slug?').path, '/posts/{slug}');
  assert.equal(normalizePath('/files{/:name}').path, '/files/{name}');
  assert.equal(normalizePath('/assets/*splat').path, '/assets/{splat}');
  assert.equal(normalizePath('/api/:id{[0-9]+}').params[0].type, 'integer');
  assert.equal(normalizePath('/x/').path, '/x');
  assert.deepEqual(variableNames('/users/{id}/posts/{postId}'), { id: 'userId' });
});

test('route names', () => {
  assert.equal(routeName('GET', '/api/v1/products', ''), 'List products');
  assert.equal(routeName('GET', '/api/v1/products/{id}', ''), 'Get product');
  assert.equal(routeName('DELETE', '/categories/{id}', ''), 'Delete category');
  assert.equal(routeName('GET', '/users', 'Find all'), 'List users');
  assert.equal(routeName('POST', '/users', 'Invite member'), 'Invite member');
});

test('postman writer: auth, login script, stable ids, form uploads', () => {
  const a = newApi('express');
  a.auth = 'bearer';
  a.loginPath = '/login';
  const login = newRoute('/login', 'POST', { isLogin: true, auth: 'none', body: newBody('json', [field('email', 'string', { required: true }), field('password', 'string', { required: true })]) });
  const upload = newRoute('/users/{id}/avatar', 'POST', { body: newBody('form', [field('avatar', 'file', { required: true })]) });
  a.routes.push(login, upload);
  const w = new Writer(a, 'Shop API', 'http://localhost:3000');
  const c = w.collection();
  assert.equal(c.info.schema, 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json');
  assert.equal(c.auth.type, 'bearer');
  const items = c.item.flatMap((f) => f.item);
  const l = items.find((i) => i.request.url.raw.endsWith('/login'));
  assert.equal(l.request.auth.type, 'noauth');
  assert.match(JSON.parse(l.request.body.raw).password, /\{\{password\}\}/);
  assert.ok(l.event[0].script.exec.join('\n').includes("pm.environment.set('access_token'"));
  const u = items.find((i) => i.request.url.raw.includes('avatar'));
  assert.equal(u.request.body.formdata[0].type, 'file');
  assert.equal(u.request.url.raw, '{{base_url}}/users/{{userId}}/avatar');
  assert.equal(uid('a', 'b'), uid('a', 'b'));
  const env = w.environment('local', 'http://localhost:3000/');
  assert.ok(env.values.some((v) => v.key === 'userId' && v.value === '1'));
  assert.ok(env.values.some((v) => v.key === 'access_token' && v.type === 'secret'));
});
