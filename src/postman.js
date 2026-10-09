// routeman model -> Postman collection v2.1 + environments.
import { createHash } from 'node:crypto';
import { NONE } from './model.js';
import { bodyExample, example, pathExample, plain } from './examples.js';
import { humanize, resource, segments, title, variableNames } from './naming.js';
import { VERSION } from './version.js';

const SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
const NAMESPACE = '6f2b8a52-1c3e-4c55-9a63-7d0f3e9b2a11';
const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const TOKEN_SCRIPT = `// routeman: store the tokens returned by this login request
let body;
try { body = pm.response.json(); } catch (e) { body = null; }
function find(obj, keys, depth) {
    if (!obj || typeof obj !== 'object' || depth > 4) return undefined;
    for (const k of keys) if (typeof obj[k] === 'string' && obj[k]) return obj[k];
    for (const v of Object.values(obj)) { const r = find(v, keys, depth + 1); if (r) return r; }
    return undefined;
}
const access = find(body, ['access_token', 'accessToken', 'access', 'token', 'jwt', 'id_token', 'idToken', 'key', 'auth_token', 'authToken'], 0);
const refresh = find(body, ['refresh_token', 'refreshToken', 'refresh'], 0);
if (access) { pm.environment.set('access_token', access); pm.collectionVariables.set('access_token', access); }
if (refresh) { pm.environment.set('refresh_token', refresh); pm.collectionVariables.set('refresh_token', refresh); }
pm.test('login returned a token', function () { pm.expect(access, 'no token found in the response').to.be.a('string'); });`;

const STATUS_SCRIPT = `pm.test('no server error', function () { pm.expect(pm.response.code).to.be.below(500); });`;
const CSRF_SCRIPT = `const csrf = pm.cookies.get('XSRF-TOKEN') || pm.cookies.get('_csrf') || pm.cookies.get('csrftoken');
if (csrf) { pm.collectionVariables.set('csrftoken', csrf); }`;

const TYPE_LABEL = { datetime: 'date-time', objectid: 'ObjectId' };

function script(lines, listen = 'test') {
  return { listen, script: { type: 'text/javascript', exec: lines.split('\n') } };
}

/** RFC 4122 version-5 UUID, so ids are stable between runs. */
export function uid(...parts) {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(ns).update(parts.map(String).join('/')).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function typeLabel(f) {
  if (f.type === 'array' && f.item) return `array of ${typeLabel(f.item)}`;
  return TYPE_LABEL[f.type] || f.type;
}

function fieldTable(fields, heading) {
  if (!fields || !fields.length) return '';
  const rows = [`**${heading}**`, '', '| Field | Type | Required | Notes |', '|---|---|---|---|'];
  for (const f of fields) {
    let notes = (f.description || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    if (f.choices && f.choices.length) {
      notes = (notes ? notes + ' ' : '') + 'One of: ' + f.choices.slice(0, 20).map((c) => '`' + JSON.stringify(plain(c)) + '`').join(', ');
    }
    rows.push(`| \`${f.name}\` | ${typeLabel(f)} | ${f.required ? 'yes' : 'no'} | ${notes} |`);
  }
  return rows.join('\n');
}

function formValue(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value && typeof value === 'object') return JSON.stringify(value);
  return value == null ? '' : String(value);
}

export class Writer {
  constructor(api, name, baseUrl = 'http://localhost:3000') {
    this.api = api;
    this.name = name;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    /** path variables -> example values */
    this.variables = new Map();
    this.idStyle = api.idStyle || 'integer';
  }

  url(route) {
    const renames = variableNames(route.path);
    const params = new Map(route.pathParams.map((p) => [p.name, p]));
    const parts = segments(route.path).map((part) => part.replace(/\{(\w+)\}/g, (_, name) => {
      const v = renames[name] || name;
      if (!this.variables.has(v)) {
        const p = params.get(name);
        this.variables.set(v, p ? pathExample(p, this.idStyle) : pathExample({ name, type: 'string', example: NONE }, this.idStyle));
      }
      return `{{${v}}}`;
    }));
    const trailing = route.path.endsWith('/') && route.path !== '/';
    const path = parts.join('/') + (trailing ? '/' : '');
    const query = route.query.map((q) => {
      const value = example(q);
      return {
        key: q.name,
        value: formValue(Array.isArray(value) ? value[0] : value),
        description: ((q.description || '') + (q.required ? ' (required)' : '')).trim(),
        disabled: !q.required,
      };
    });
    const enabled = query.filter((q) => !q.disabled);
    let raw = '{{base_url}}/' + path;
    if (enabled.length) raw += '?' + enabled.map((q) => `${q.key}=${q.value}`).join('&');
    const url = { raw, host: ['{{base_url}}'], path: trailing ? [...parts, ''] : parts };
    if (query.length) url.query = query;
    return url;
  }

  body(b, method) {
    if (b.mode === 'json') {
      let value = b.example !== NONE ? plain(b.example) : bodyExample(b.fields);
      if (method === 'PATCH' && b.example === NONE && b.fields.length && !b.partial) {
        const required = new Set(b.fields.filter((f) => f.required).map((f) => f.name));
        const trimmed = Object.fromEntries(Object.entries(value).filter(([k]) => required.has(k)));
        if (Object.keys(trimmed).length) value = trimmed;
      }
      return { mode: 'raw', raw: JSON.stringify(value, null, 2), options: { raw: { language: 'json' } } };
    }
    if (b.mode === 'raw') return { mode: 'raw', raw: '' };
    const entries = [];
    for (const f of b.fields) {
      const notes = ((f.description || '') + (f.required ? ' (required)' : '')).trim();
      if (f.type === 'file' || (f.type === 'array' && f.item && f.item.type === 'file')) {
        entries.push({ key: f.name, type: 'file', src: [], description: notes });
        continue;
      }
      const value = example(f);
      const values = Array.isArray(value) && f.type === 'array' && value.length ? value : [value];
      for (const v of values) {
        const entry = { key: f.name, value: formValue(v), description: notes };
        if (!f.required && !b.partial) entry.disabled = true; // optional: switch it on in Postman when needed
        if (b.mode === 'form') entry.type = 'text';
        entries.push(entry);
      }
    }
    return b.mode === 'form' ? { mode: 'formdata', formdata: entries } : { mode: 'urlencoded', urlencoded: entries };
  }

  request(route) {
    const headers = [{ key: 'Accept', value: 'application/json' }];
    const req = { method: route.method, header: headers, url: this.url(route) };
    const notes = route.description ? [route.description.trim()] : [];
    if (route.body) {
      if (route.body.mode === 'json') headers.push({ key: 'Content-Type', value: 'application/json' });
      else if (route.body.mode === 'urlencoded') headers.push({ key: 'Content-Type', value: 'application/x-www-form-urlencoded' });
      if (route.isLogin) {
        for (const f of route.body.fields) {
          if (f.example !== NONE && typeof f.example === 'string' && f.example.startsWith('{{')) continue;
          if (/pass/i.test(f.name) && !/confirm|new|old/i.test(f.name)) f.example = '{{password}}';
          else if (/^(username|user|email|login|phone|mobile|identifier|user_?name|email_?address)$/i.test(f.name)) f.example = '{{username}}';
        }
      }
      req.body = this.body(route.body, route.method);
      if (route.body.partial) notes.push('_Body fields were found by reading the handler code, so this list may be incomplete._');
      notes.push(fieldTable(route.body.fields, 'Body'));
    }
    for (const h of route.headers) {
      headers.push({ key: h.name, value: formValue(example(h)), description: h.description || '' });
    }
    if (route.csrf && !['GET', 'HEAD', 'OPTIONS'].includes(route.method)) {
      headers.push({ key: 'X-CSRF-Token', value: '{{csrftoken}}', description: 'CSRF token; send any GET first so the cookie is set.' });
    }
    notes.push(fieldTable(route.query, 'Query parameters'));
    if (route.source) notes.push(`Source: \`${route.source}\``);
    req.description = notes.filter(Boolean).join('\n\n');
    if (route.auth && route.auth.startsWith('apikey:')) {
      req.auth = { type: 'apikey', apikey: [
        { key: 'key', value: route.auth.slice(7), type: 'string' },
        { key: 'value', value: '{{api_key}}', type: 'string' },
        { key: 'in', value: 'header', type: 'string' }] };
    } else if (route.auth === 'basic' && this.api.auth !== 'basic') {
      req.auth = { type: 'basic', basic: [
        { key: 'username', value: '{{username}}', type: 'string' },
        { key: 'password', value: '{{password}}', type: 'string' }] };
    } else if (route.auth === 'none' && this.auth()) req.auth = { type: 'noauth' };
    else if (route.auth === 'refresh') {
      req.auth = { type: 'bearer', bearer: [{ key: 'token', value: '{{refresh_token}}', type: 'string' }] };
    }
    const item = { id: uid(this.name, route.method, route.path), name: title(route), request: req, response: [] };
    if (route.isLogin) item.event = [script(TOKEN_SCRIPT)];
    return item;
  }

  items() {
    const order = (m) => (METHOD_ORDER.includes(m) ? METHOD_ORDER.indexOf(m) : 9);
    const keyOf = (r) => (r.folder[0] ? humanize(r.folder[0]) : humanize(resource(r.path)) || '~');
    const routes = [...this.api.routes].sort((a, b) => keyOf(a).localeCompare(keyOf(b))
      || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || order(a.method) - order(b.method));
    /** @type {Map<string, Map<string, object[]>>} */
    const tree = new Map();
    for (const r of routes) {
      let top = r.folder[0] || '';
      let res = r.folder[1] || resource(r.path, top);
      if (!top) { top = res || 'root'; res = ''; }
      const folder = humanize(top) || 'Root';
      if (!tree.has(folder)) tree.set(folder, new Map());
      const groups = tree.get(folder);
      const group = humanize(res);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(this.request(r));
    }
    const out = [];
    for (const [folder, groups] of tree) {
      const children = [];
      const singles = [];
      for (const [group, requests] of groups) {
        if (group && requests.length > 1 && groups.size > 1) children.push({ name: group, item: requests });
        else singles.push(...requests);
      }
      out.push({ name: folder, item: [...children, ...singles] });
    }
    return out;
  }

  auth() {
    const { auth, tokenPrefix, authHeader } = this.api;
    if (auth === 'bearer') return { type: 'bearer', bearer: [{ key: 'token', value: '{{access_token}}', type: 'string' }] };
    if (auth === 'token') {
      return { type: 'apikey', apikey: [
        { key: 'key', value: 'Authorization', type: 'string' },
        { key: 'value', value: `${tokenPrefix} {{access_token}}`, type: 'string' },
        { key: 'in', value: 'header', type: 'string' }] };
    }
    if (auth === 'apikey' || auth === 'header') {
      return { type: 'apikey', apikey: [
        { key: 'key', value: authHeader, type: 'string' },
        { key: 'value', value: auth === 'header' ? '{{access_token}}' : '{{api_key}}', type: 'string' },
        { key: 'in', value: 'header', type: 'string' }] };
    }
    if (auth === 'basic') {
      return { type: 'basic', basic: [
        { key: 'username', value: '{{username}}', type: 'string' },
        { key: 'password', value: '{{password}}', type: 'string' }] };
    }
    return null;
  }

  description() {
    const a = this.api;
    const lines = [
      `Generated by [routeman](https://www.npmjs.com/package/routeman-cli) ${VERSION} from the source code of the ${a.framework} project.`,
      '', '**Getting started**', '1. Import the environment file and select it (top-right in Postman).',
    ];
    const help = {
      bearer: 'Requests send `Authorization: Bearer {{access_token}}`.',
      token: `Requests send \`Authorization: ${a.tokenPrefix} {{access_token}}\`.`,
      header: `Requests send \`${a.authHeader}: {{access_token}}\`.`,
      apikey: `Requests send \`${a.authHeader}: {{api_key}}\`; set \`api_key\` in the environment.`,
      basic: 'Requests use HTTP Basic auth with `username` / `password` from the environment.',
      session: 'The API uses session cookies: run the login request first; Postman keeps the cookie.',
    }[a.auth];
    const tokenAuth = a.auth === 'bearer' || a.auth === 'token' || a.auth === 'header';
    if (a.loginPath && tokenAuth) {
      lines.push(`2. Set \`username\` and \`password\` in the environment, then run the login request (\`${a.loginPath}\`); the returned token is saved to \`access_token\` automatically.`);
    } else if (a.loginPath && a.auth === 'session') {
      lines.push(`2. Run the login request (\`${a.loginPath}\`) first; Postman keeps the session cookie.`);
    } else if (tokenAuth) {
      lines.push('2. Paste a token into the `access_token` environment variable.');
    }
    if (help) lines.push(help);
    lines.push('3. Path ids such as `{{userId}}` are environment variables; set them from list responses.', '');
    lines.push('Every request checks that the server did not answer with a 5xx, so the collection can be run as a smoke test. Requests that change data run against the selected environment.');
    if (a.websockets.length) {
      lines.push('', '**WebSocket endpoints** (open with *New → WebSocket* in Postman):', '');
      for (const w of a.websockets) {
        lines.push(`- \`{{ws_url}}${w.path.replace(/\{(\w+)\}/g, '{{$1}}')}\`` + (w.description ? ` — ${w.description}` : ''));
      }
    }
    return lines.join('\n');
  }

  collection() {
    const item = this.items();
    const csrf = this.api.routes.some((r) => r.csrf);
    const event = [script(STATUS_SCRIPT)];
    if (csrf) event.push(script(CSRF_SCRIPT));
    const variable = [{ key: 'base_url', value: this.baseUrl }];
    if (['bearer', 'token', 'header'].includes(this.api.auth)) {
      variable.push({ key: 'access_token', value: '' }, { key: 'refresh_token', value: '' });
    }
    if (csrf) variable.push({ key: 'csrftoken', value: '' });
    const out = {
      info: { _postman_id: uid('collection', this.name), name: this.name, description: this.description(), schema: SCHEMA },
      item, event, variable,
    };
    const auth = this.auth();
    if (auth) out.auth = auth;
    return out;
  }

  environment(envName, baseUrl) {
    baseUrl = baseUrl.replace(/\/+$/, '');
    const values = [{ key: 'base_url', value: baseUrl, type: 'default', enabled: true }];
    if (this.api.websockets.length) {
      const ws = baseUrl.replace(/^http(s?):/, 'ws$1:');
      values.push({ key: 'ws_url', value: ws, type: 'default', enabled: true });
    }
    if (['bearer', 'token', 'header'].includes(this.api.auth)) {
      values.push({ key: 'access_token', value: '', type: 'secret', enabled: true },
        { key: 'refresh_token', value: '', type: 'secret', enabled: true });
    }
    if (this.api.auth === 'apikey' || this.api.routes.some((r) => r.auth && r.auth.startsWith('apikey:'))) values.push({ key: 'api_key', value: '', type: 'secret', enabled: true });
    if (this.api.auth === 'basic' || this.api.loginPath) {
      values.push({ key: 'username', value: '', type: 'default', enabled: true },
        { key: 'password', value: '', type: 'secret', enabled: true });
    }
    for (const [key, value] of this.variables) values.push({ key, value, type: 'default', enabled: true });
    return { id: uid('environment', this.name, envName), name: `${this.name} - ${envName}`, values, _postman_variable_scope: 'environment' };
  }
}
