// JSON Schema / OpenAPI 3 / Swagger 2 -> routeman model.
import { NONE, api as newApi, body as newBody, field as newField, route as newRoute } from './model.js';
import { example } from './examples.js';
import { humanize } from './naming.js';

const FORMATS = {
  uuid: 'uuid', date: 'date', 'date-time': 'datetime', time: 'time', email: 'email',
  uri: 'url', url: 'url', binary: 'file', 'uri-reference': 'url',
};
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

export class SchemaReader {
  constructor(root) {
    this.root = root || {};
  }

  deref(schema, seen = []) {
    while (isObj(schema) && typeof schema.$ref === 'string') {
      const ref = schema.$ref;
      if (seen.includes(ref)) return {};
      seen = [...seen, ref];
      let node = this.root;
      if (ref.startsWith('#')) {
        for (const part of ref.replace(/^#\/?/, '').split('/').filter(Boolean)) {
          node = isObj(node) ? node[decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~')] : undefined;
        }
      } else node = (this.root.definitions || {})[ref] || {};
      const { $ref, ...extra } = schema;
      schema = { ...(isObj(node) ? node : {}), ...extra };
    }
    return isObj(schema) ? schema : {};
  }

  field(name, schema, required = false, depth = 0, seen = []) {
    if (isObj(schema) && schema.__field) {
      return { ...schema.__field, name, required: schema.__field.required && required !== false ? true : required };
    }
    const ref = isObj(schema) ? schema.$ref : undefined;
    if (ref && seen.includes(ref)) return newField(name, 'object', { required, children: [] });
    if (ref) seen = [...seen, ref];
    schema = this.deref(schema);
    for (const key of ['anyOf', 'oneOf']) {
      if (Array.isArray(schema[key])) {
        const options = schema[key].filter((o) => this.deref(o).type !== 'null');
        const literals = options.map((o) => this.deref(o)).filter((o) => 'const' in o);
        if (literals.length === options.length && literals.length) {
          const f = newField(name, typeof literals[0].const === 'number' ? 'number' : 'string', { required });
          f.choices = literals.map((o) => o.const);
          return f;
        }
        if (options.length) {
          const { [key]: _, ...merged } = schema;
          const inner = this.field(name, options[0], required, depth, seen);
          if ('default' in merged) inner.default = merged.default;
          if (merged.description && !inner.description) inner.description = merged.description;
          if ('example' in merged) inner.example = merged.example;
          return inner;
        }
      }
    }
    if (Array.isArray(schema.allOf)) {
      let { allOf, ...merged } = schema;
      for (let part of allOf) {
        part = this.deref(part, seen);
        merged = {
          ...part, ...merged,
          properties: { ...(part.properties || {}), ...(merged.properties || {}) },
          required: [...(merged.required || []), ...(part.required || [])],
        };
      }
      schema = merged;
    }
    let kind = schema.type;
    if (Array.isArray(kind)) kind = kind.find((k) => k !== 'null') || 'string';
    const fmt = schema.format;
    const f = newField(name, 'string', { required, description: schema.description || schema.title || '' });
    if (name && f.description.toLowerCase() === humanize(name).toLowerCase()) f.description = '';
    if ('example' in schema) f.example = schema.example;
    else if (Array.isArray(schema.examples) && schema.examples.length) f.example = schema.examples[0];
    if ('default' in schema) f.default = schema.default;
    if ('const' in schema) f.choices = [schema.const];
    if (Array.isArray(schema.enum)) f.choices = schema.enum.filter((v) => v !== null);
    if (kind === 'object' || isObj(schema.properties)) {
      f.type = 'object';
      const req = new Set(Array.isArray(schema.required) ? schema.required : []);
      f.children = depth > 6 ? [] : Object.entries(schema.properties || {})
        .filter(([, v]) => !this.deref(v).readOnly)
        .map(([k, v]) => this.field(k, v, req.has(k), depth + 1, seen));
    } else if (kind === 'array') {
      f.type = 'array';
      f.item = this.field(name, schema.items || {}, false, depth + 1, seen);
    } else if (FORMATS[fmt]) {
      f.type = FORMATS[fmt];
    } else if (kind === 'string' && schema.contentMediaType && schema.contentEncoding !== 'utf-8') {
      f.type = 'file';
    } else if (kind === 'file') {
      f.type = 'file';
    } else if (['integer', 'number', 'boolean', 'string'].includes(kind)) {
      f.type = kind;
    } else if (kind === 'null') {
      f.type = 'any';
    } else {
      f.type = schema.instanceOf === 'Date' ? 'datetime' : 'any';
    }
    const limits = {};
    if (schema.minLength != null) limits.minLength = schema.minLength;
    if (schema.maxLength != null) limits.maxLength = schema.maxLength;
    if (schema.minimum != null) limits.min = schema.minimum;
    if (schema.maximum != null) limits.max = schema.maximum;
    if (typeof schema.exclusiveMinimum === 'number') limits.exclusiveMin = schema.exclusiveMinimum;
    if (typeof schema.exclusiveMaximum === 'number') limits.exclusiveMax = schema.exclusiveMaximum;
    if (schema.minItems != null) limits.minItems = schema.minItems;
    if (schema.pattern) limits.pattern = schema.pattern;
    if (Object.keys(limits).length) f.limits = limits;
    return f;
  }

  objectFields(schema) {
    const f = this.field('', schema);
    return f.type === 'object' ? f.children || [] : [];
  }
}

export function fieldsFromJsonSchema(schema) {
  return new SchemaReader(schema).objectFields(schema);
}

const API_KEY_HEADERS = new Set(['x-api-key', 'api-key', 'apikey', 'x-api-token', 'x-auth-token', 'x-access-token']);

function securityKind(s) {
  const t = s.type;
  if (t === 'apiKey') return 'apikey';
  if (t === 'http') return (s.scheme || '').toLowerCase() === 'basic' ? 'basic' : 'bearer';
  if (t === 'basic') return 'basic'; // swagger 2
  return 'bearer'; // oauth2, openIdConnect
}

/** Convert an OpenAPI 3.x or Swagger 2.0 document. */
export function fromOpenapi(spec, framework = 'openapi') {
  const reader = new SchemaReader(spec);
  const a = newApi(framework);
  a.title = (spec.info || {}).title || '';
  const swagger2 = typeof spec.swagger === 'string';
  const schemes = (swagger2 ? spec.securityDefinitions : (spec.components || {}).securitySchemes) || {};
  const kinds = {};
  for (const [name, s] of Object.entries(schemes)) {
    kinds[name] = securityKind(s);
    if (s.type === 'apiKey' && s.in === 'header') a.authHeader = s.name || 'Authorization';
    if (s.type === 'oauth2') {
      const url = (((s.flows || {}).password || {}).tokenUrl) || (s.flow === 'password' ? s.tokenUrl : '');
      if (url) a.loginPath = url.startsWith('http') ? url : '/' + url.replace(/^\/+/, '');
    }
  }
  let basePath = '';
  if (swagger2) basePath = (spec.basePath || '').replace(/\/+$/, '');
  else if (Array.isArray(spec.servers) && spec.servers[0]) {
    const m = /^(?:https?:\/\/[^/]+)?(\/.*)$/.exec(spec.servers[0].url || '');
    if (m && m[1] !== '/') basePath = m[1].replace(/\/+$/, '');
  }
  const used = [];
  const headerAuth = new Map();
  for (const [path, item] of Object.entries(spec.paths || {})) {
    if (!isObj(item)) continue;
    const common = item.parameters || [];
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      const op = item[method];
      if (!isObj(op)) continue;
      const r = newRoute(basePath + path, method.toUpperCase(), {
        name: op.summary || op.operationId || '', description: op.description || '',
        folder: (op.tags || []).slice(0, 1), source: op.operationId || '',
      });
      let formFields = null;
      for (let p of [...common, ...(op.parameters || [])]) {
        p = reader.deref(p);
        const where = p.in;
        const f = reader.field(p.name || '', p.schema || (swagger2 ? p : {}), !!p.required);
        if (p.description) f.description = p.description;
        if ('example' in p) f.example = p.example;
        if (where === 'path') r.pathParams.push(f);
        else if (where === 'query') r.query.push(f);
        else if (where === 'header') {
          const lower = (p.name || '').toLowerCase();
          if (lower === 'authorization') { if (!headerAuth.has(r)) headerAuth.set(r, ['bearer', 'Authorization']); }
          else if (API_KEY_HEADERS.has(lower)) { if (!headerAuth.has(r)) headerAuth.set(r, ['apikey', p.name]); }
          else if (!['content-type', 'accept'].includes(lower)) r.headers.push(f);
        } else if (where === 'body') {
          r.body = newBody('json', reader.objectFields(p.schema || {}));
        } else if (where === 'formData') {
          (formFields = formFields || []).push(f);
        }
      }
      if (formFields) {
        const consumes = op.consumes || spec.consumes || [];
        const multipart = formFields.some((f) => f.type === 'file') || consumes.includes('multipart/form-data');
        r.body = newBody(multipart ? 'form' : 'urlencoded', formFields);
      }
      const rb = reader.deref(op.requestBody || {});
      const content = rb.content || {};
      let matched = false;
      for (const [mime, mode] of [['application/json', 'json'], ['multipart/form-data', 'form'], ['application/x-www-form-urlencoded', 'urlencoded']]) {
        const key = Object.keys(content).find((k) => k.split(';')[0].trim() === mime || (mime === 'application/json' && /\+json$/.test(k)));
        if (!key) continue;
        const media = content[key] || {};
        const schema = media.schema || {};
        const b = newBody(mode, reader.objectFields(schema));
        if ('example' in media) b.example = media.example;
        else if (!b.fields.length && !['object', undefined].includes(reader.deref(schema).type)) b.example = example(reader.field('body', schema));
        r.body = b;
        matched = true;
        break;
      }
      if (!matched && Object.keys(content).length) r.body = newBody('raw');
      const security = op.security !== undefined ? op.security : spec.security;
      if (security !== undefined && security !== null) {
        if (!security.length || (security.length === 1 && !Object.keys(security[0] || {}).length)) r.auth = 'none';
        else {
          for (const req of security) for (const n of Object.keys(req || {})) used.push(kinds[n] || 'bearer');
          if (security.some((s) => !Object.keys(s || {}).length)) r.auth = null;
        }
      } else if (Object.keys(schemes).length) r.auth = 'none';
      a.routes.push(r);
    }
  }
  if (used.length) {
    const counts = {};
    for (const u of used) counts[u] = (counts[u] || 0) + 1;
    a.auth = Object.entries(counts).sort((x, y) => y[1] - x[1])[0][0];
  } else if (headerAuth.size) {
    const [kind, header] = [...headerAuth.values()][0];
    a.auth = kind;
    a.authHeader = header;
    for (const r of a.routes) if (!headerAuth.has(r)) r.auth = 'none';
  }
  for (const r of a.routes) {
    if (a.loginPath && r.method === 'POST' && r.path.replace(/\/+$/, '') === a.loginPath.replace(/\/+$/, '')) {
      r.isLogin = true;
      r.auth = 'none';
    }
  }
  return a;
}

export { NONE };
