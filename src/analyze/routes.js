// Router graphs -> flat routes -> analysed routeman routes (fields, auth, names).
import { NONE, body as newBody, field as newField, route as newRoute, cloneField } from '../model.js';
import { humanize, joinPath } from '../naming.js';
import { Collector, role, authName, APIKEY_HEADER } from './roles.js';
import { toField, evFields, jsonSchemaOf } from './schemas.js';
import { U, UNDEF, obj, pkgPath, jsValue } from './values.js';

const HANDLER_BUDGET = 150_000;

// --- path syntax -----------------------------------------------------------------------------

/**
 * Framework path -> '/users/{id}' plus parameter types.
 * Handles :id, :id?, :id(\\d+), :id{[0-9]+}, {/:opt} (Express 5), *splat, *, regex-free paths.
 */
export function normalizePath(raw) {
  const params = [];
  let p = String(raw || '/');
  p = p.replace(/\{(\/?):(\w+)\}/g, '$1:$2'); // Express 5 optional segment
  p = p.replace(/\{\/?\*(\w+)\}/g, '/*$1');
  p = p.replace(/:(\w+)(\{[^}]*\}|\([^)]*\))?\??/g, (_, name, constraint) => {
    let type = 'string';
    if (constraint) {
      const c = constraint.slice(1, -1);
      if (/^(\\d|\[0-9\])(\+|\*|\{\d+(,\d*)?\})$/.test(c)) type = 'integer';
      else if (/0-9a-f/i.test(c) && c.includes('-')) type = 'uuid';
      else if (/^\[0-9a-f(A-F)?\]\{24\}$/i.test(c)) type = 'objectid';
    }
    params.push({ name, type });
    return `{${name}}`;
  });
  p = p.replace(/\*(\w+)/g, (_, name) => { params.push({ name, type: 'string' }); return `{${name}}`; });
  p = p.replace(/(^|\/)\*$/, (_, s) => { params.push({ name: 'path', type: 'string' }); return `${s}{path}`; });
  p = p.replace(/\/\*\//g, '/{path}/');
  return { path: joinPath(p), params };
}

function regexToPath(source) {
  // /^\/users\/?$/i -> /users ; anything dynamic -> null
  let s = source.replace(/^\^/, '').replace(/\\?\/\??\$?$/, '').replace(/\$$/, '');
  s = s.replace(/\\\//g, '/');
  if (/[()[\]{}*+?|\\]/.test(s)) return null;
  return s || '/';
}

// --- flattening --------------------------------------------------------------------------------

function scopedMatch(pattern, full, fw) {
  if (pattern === '*' || pattern === '/*' || pattern === '/') return true;
  if (pattern.endsWith('/*')) {
    const base = pattern.slice(0, -2);
    return full === base || full.startsWith(base + '/');
  }
  if (fw === 'hono') return full === pattern;
  return full === pattern || full.startsWith(pattern.replace(/\/$/, '') + '/');
}

/** Turn every router reachable from the roots into a list of routes with their middleware chains. */
export function flatten(interp) {
  const mounted = new Set();
  for (const r of interp.routers) for (const e of r.entries) if (e.t === 'mount') mounted.add(e.target);
  // a Hono basePath() instance mounted elsewhere is reached through that mount, not through the original
  const reachedElsewhere = new Set();
  for (const r of interp.routers) for (const e of r.entries) if (e.t === 'mount' && !e.shared && e.target.basePathOf) reachedElsewhere.add(e.target);
  for (const r of interp.routers) r.entries = r.entries.filter((e) => !(e.t === 'mount' && e.shared && reachedElsewhere.has(e.target)));
  const roots = interp.routers.filter((r) => !mounted.has(r) && !r.chainOf && !r.routeRef && hasContent(r, new Set()));
  const out = [];
  const raws = [];
  const walk = (r, prefix, mws, hooks, guards, scoped, stack) => {
    if (stack.includes(r) || stack.length > 30) return;
    const base = joinPath(prefix, r.prefix || '');
    const local = [...mws];
    const localScoped = [...scoped];
    const localGuards = [...guards];
    const ownHooks = r.entries.filter((e) => e.t === 'hook').flatMap((e) => e.mws);
    const allHooks = [...hooks, ...ownHooks];
    for (const e of r.entries) {
      switch (e.t) {
        case 'use':
          if (e.path == null) local.push(...e.mws);
          else localScoped.push({ pattern: joinPath(base, e.path).replace(/\/\*$/, '/*'), raw: e.path, mws: e.mws, fw: r.fw });
          break;
        case 'guard':
          localGuards.push(e.hook);
          break;
        case 'route': {
          if (e.removed) break;
          let rawPath = e.path;
          if (rawPath == null && e.regex) {
            rawPath = regexToPath(e.regex);
            if (rawPath == null) {
              interp.warn(`${e.where}: regular-expression route /${e.regex}/ skipped`);
              break;
            }
          }
          // normalise the joined path so parameters in mount prefixes (fastify prefix '/a/:id') are converted too
          const { path: full, params } = normalizePath(joinPath(base, rawPath === '/' ? '' : rawPath));
          const matched = localScoped.filter((s) => scopedMatch(s.pattern.endsWith('*') ? s.pattern : s.raw === '*' ? '*' : s.pattern, full, s.fw)).flatMap((s) => s.mws);
          out.push({ ...e, router: r, fw: r.fw, fullPath: full, rawPath, params, chain: [...allHooks, ...local, ...matched, ...e.handlers], guards: localGuards, mainIndex: allHooks.length + local.length + matched.length + e.handlers.length - 1, rootRouter: stack[0] || r });
          break;
        }
        case 'mount': {
          const mp = joinPath(base, e.path || '');
          const matched = localScoped.filter((s) => s.pattern === '*' || s.raw === '*' || mp === s.pattern || mp.startsWith(s.pattern.replace(/\/\*$/, '') + '/')).flatMap((s) => s.mws);
          walk(e.target, mp, [...local, ...matched, ...e.mws], r.fw === 'fastify' && e.target.fw === 'fastify' ? allHooks : [], localGuards, localScoped, [...stack, r]);
          break;
        }
        case 'raw':
          raws.push({ ...e, prefix: base, chain: [...allHooks, ...local], router: r });
          break;
        default:
          break;
      }
    }
  };
  for (const r of roots) walk(r, '', [], [], [], [], []);
  return { routes: out, raws, roots };
}

function hasContent(r, seen) {
  if (seen.has(r)) return false;
  seen.add(r);
  return r.entries.some((e) => e.t === 'route' || e.t === 'raw' || (e.t === 'mount' && hasContent(e.target, seen)));
}

// --- running handlers ----------------------------------------------------------------------------

/** Arguments a handler receives, per framework. */
function handlerArgs(fw, col, meta) {
  switch (fw) {
    case 'koa': case 'koa-router': case 'oak': case 'oak-router': return [role('ctx', col), U];
    case 'hono': return [role('honoCtx', col), U];
    case 'elysia': return [role('elysiaCtx', col)];
    case 'hapi': return [role('hapiReq', col), U];
    case 'h3': case 'nitro': return [role('event', col)];
    case 'bun': case 'fetch': case 'next-app': case 'deno': return [role('fetchReq', col), role('nextCtx', col)];
    case 'sveltekit': case 'astro': case 'remix': return [role('kitEvent', col)];
    case 'adonis': return [role('adonisCtx', col)];
    case 'itty': return [role('ittyReq', col), U];
    case 'node': return [role('nodeReq', col), U];
    case 'feathers': {
      const params = obj([['query', { k: 'role', role: 'field', col, loc: 'query', path: [] }], ['user', U], ['provider', U]]);
      const bodyRole = { k: 'role', role: 'field', col, loc: 'body', path: [] };
      switch (meta && meta.feathers) {
        case 'create': return [bodyRole, params];
        case 'update': case 'patch': return [U, bodyRole, params];
        case 'find': return [params];
        default: return [U, params];
      }
    }
    default: return [role('req', col), role('res', col), U];
  }
}

export function runBudget(interp, fnCall) {
  const saved = { steps: interp.steps, max: interp.maxSteps, exhausted: interp.exhausted, stack: interp.stack };
  interp.steps = 0;
  interp.maxSteps = HANDLER_BUDGET;
  interp.exhausted = false;
  interp.stack = [];
  try {
    fnCall();
  } catch (err) {
    if (!(err instanceof RangeError) && process.env.ROUTEMAN_DEBUG) throw err;
  } finally {
    interp.steps = saved.steps;
    interp.maxSteps = saved.max;
    interp.exhausted = saved.exhausted;
    interp.stack = saved.stack;
  }
}

/** Analyse one handler/middleware value; results are cached per value. */
function analyseValue(interp, v, fw, meta, cache) {
  const key = v;
  let byFw = cache.get(key);
  if (!byFw) { byFw = new Map(); cache.set(key, byFw); }
  const ck = fw + '|' + (meta && meta.feathers ? meta.feathers : '');
  if (byFw.has(ck)) return byFw.get(ck);
  const col = new Collector(fw === 'oak' || fw === 'oak-router' ? 'oak' : fw);
  byFw.set(ck, col);
  if (v.k === 'f' && v.node) {
    const prev = interp.analyzing;
    interp.analyzing = col;
    runBudget(interp, () => interp.callFunction(v, handlerArgs(fw, col, meta), v.boundThis || UNDEF, null));
    interp.analyzing = prev;
  } else if (v.k === 'p') {
    pkgMiddleware(interp, v, col);
  } else if (v.k === 'u') {
    if (v.authMw) { col.hints.add('protect'); col.hints.add(v.authMw); col.unless = v.unless; }
    if (v.passport !== undefined) passportHints(v.passport, col);
    if (authName(v.name)) col.hints.add('named-auth');
  } else if (v.k === 'ev') {
    col.evChains = [v];
  } else if (v.k === 'o' && v.node === undefined) {
    // nothing
  }
  return col;
}

function passportHints(strategy, col) {
  const s = String(strategy || '').toLowerCase();
  if (s === 'local') col.hints.add('login-strategy');
  else if (/jwt|bearer/.test(s)) { col.hints.add('protect'); col.hints.add('bearer'); } else if (s === 'basic' || s === 'digest') { col.hints.add('protect'); col.hints.add('basic'); } else if (/api.?key|headerapikey/.test(s)) { col.hints.add('protect'); col.hints.add('apikey'); } else if (s === 'session') { col.hints.add('protect'); col.hints.add('session'); }
}

/** Middleware from packages: multer, validators, auth middleware. */
function pkgMiddleware(interp, p, col) {
  const name = p.pkg;
  const sig = pkgPath(p);
  const calls = p.chain.filter((c) => 'call' in c);
  const last = calls.length ? calls[calls.length - 1].call : [];
  if (name === 'multer' || name === '@koa/multer' || name === 'koa-multer') {
    col.mode = 'form';
    const m = /\.(single|array|fields|any|none)\(\)$/.exec(sig);
    if (m) {
      if (m[1] === 'single' && last[0] && last[0].k === 's') col.file(last[0].v);
      else if (m[1] === 'array' && last[0] && last[0].k === 's') col.file(last[0].v, true);
      else if (m[1] === 'fields' && last[0] && last[0].k === 'a') {
        for (const it of last[0].items) {
          const n = it.k === 'o' ? it.props.get('name') : null;
          if (n && n.k === 's') col.file(n.v);
        }
      }
    }
    return;
  }
  if (name === 'express-fileupload' || name === 'formidable' || name === 'busboy' || name === 'koa-body' || name === '@fastify/multipart') {
    if (name === 'koa-body') {
      const o = last[0];
      if (o && o.k === 'o' && o.props.get('multipart') && o.props.get('multipart').v) col.multipartCapable = true;
    }
    return;
  }
  // Generic validator middleware: zValidator('json', schema), celebrate({ body }), validateRequest({ body, query }), ...
  const loc = (s) => ({ json: 'body', body: 'body', form: 'body', query: 'query', param: 'params', params: 'params', header: 'headers', headers: 'headers' }[s] || null);
  const strArg = last.find((a) => a && a.k === 's');
  for (const a of last) {
    if (!a) continue;
    if (a.k === 'z' || a.k === 'c') {
      const where = strArg ? loc(strArg.v) : 'body';
      if (where) col.schemas.push({ loc: where, value: a });
      if (strArg && strArg.v === 'form') col.mode = 'form';
    } else if (a.k === 'o') {
      for (const [k, v] of a.props) {
        const where = loc(k);
        if (where && v && (v.k === 'z' || v.k === 'c' || v.k === 'o')) col.schemas.push({ loc: where, value: v });
      }
    } else if (a.k === 'f' && /validator\(\)$/.test(sig)) {
      // hono/validator: validator('json', (value, c) => ...)
      const where = strArg ? loc(strArg.v) : 'body';
      if (where) {
        const prev = interp.analyzing;
        interp.analyzing = col;
        runBudget(interp, () => interp.callFunction(a, [{ k: 'role', role: 'field', col, loc: where === 'params' ? 'query' : where, path: [] }, U], UNDEF, null));
        interp.analyzing = prev;
      }
    }
  }
  // Wrappers: asyncHandler(fn), catchAsync(fn) -> analyse the wrapped function
  const inner = last.find((a) => a && a.k === 'f');
  if (inner && !/validator\(\)$/.test(sig)) col.wrapped = inner;
}

function mergeNode(dst, src) {
  if (src.touched) dst.touched = true;
  if (src.pattern) dst.pattern = src.pattern;
  if (src.type && (!dst.type || dst.type === 'any' || (dst.type === 'string' && src.type !== 'any'))) dst.type = src.type;
  if (src.required) dst.required = true;
  if (src.default !== NONE) dst.default = src.default;
  for (const c of src.choices) dst.choices.add(c);
  if (src.input) dst.input = true;
  if (src.item) {
    if (!dst.item) dst.item = { children: new Map(), type: null, required: false, default: NONE, choices: new Set(), item: null, order: 0 };
    mergeNode(dst.item, src.item);
  }
  for (const [k, c] of src.children) {
    if (!dst.children.has(k)) dst.children.set(k, { children: new Map(), type: null, required: false, default: NONE, choices: new Set(), item: null, order: c.order });
    mergeNode(dst.children.get(k), c);
  }
}

function mergeInto(dst, src) {
  for (const [key, t] of src.trees) {
    let d = dst.trees.get(key);
    if (!d) {
      d = { method: t.method, path: t.path, body: { children: new Map(), type: null, required: false, default: NONE, choices: new Set(), item: null }, query: { children: new Map(), type: null, required: false, default: NONE, choices: new Set(), item: null }, headers: new Map(), files: new Map(), params: { children: new Map() } };
      dst.trees.set(key, d);
    }
    mergeNode(d.body, t.body);
    mergeNode(d.query, t.query);
    if (t.body.input) d.body.input = true;
    for (const [k, h] of t.headers) if (!d.headers.has(k)) d.headers.set(k, h);
    for (const [k, f] of t.files) d.files.set(k, f);
  }
  dst.schemas.push(...src.schemas);
  dst.types.push(...src.types);
  if (src.mode === 'form' || (src.mode && !dst.mode)) dst.mode = src.mode;
  for (const c of src.conds) dst.conds.push(c);
  for (const [k, v] of src.pathTypes) dst.pathTypes.set(k, v);
  if (src.evChains) dst.evChains = [...(dst.evChains || []), ...src.evChains];
  if (src.protectAt) dst.protectAt.push(...src.protectAt);
  if (src.ormModels) dst.ormModels = [...(dst.ormModels || []), ...src.ormModels];
  for (const h of src.hints) if (h === 'multipart' || h === 'raw-body') dst.hints.add(h);
}

// --- fields from the collector ---------------------------------------------------------------------

function nodeToField(name, n, partial) {
  if (n.type === 'file') return newField(name, 'file', { required: !!n.required }); // avatar.size, avatar.name are file properties
  let type = n.type || (n.children.size ? 'object' : n.item ? 'array' : 'any');
  if (type === 'object' && !n.children.size && n.item) type = 'array';
  const f = newField(name, type, { required: !!n.required });
  if (n.default !== NONE) f.default = n.default;
  if (n.choices.size) f.choices = [...n.choices];
  if (n.pattern) f.limits = { ...(f.limits || {}), pattern: n.pattern };
  if (type === 'object' || n.children.size) {
    f.type = type === 'array' ? 'array' : 'object';
    if (f.type === 'object') f.children = [...n.children].sort((a, b) => a[1].order - b[1].order).map(([k, c]) => nodeToField(k, c, partial));
  }
  if (f.type === 'array') {
    f.item = n.item ? nodeToField(name, n.item, partial) : null;
    if (f.item && f.item.type === 'any' && !n.item.children.size) f.item.type = 'string';
  }
  return f;
}

function treeFields(node) {
  return [...node.children].sort((a, b) => a[1].order - b[1].order).map(([k, c]) => nodeToField(k, c, true));
}

function schemaFields(interp, entries, loc) {
  const out = [];
  for (const { loc: l, value } of entries) {
    if (l !== loc) continue;
    let f = null;
    if (value && value.k === 'o' && !value.node && value.props.size && [...value.props.values()].every((v) => v.k === 'z')) {
      // Joi/celebrate shape without Joi.object(): { email: Joi.string() }
      f = toField(interp, value, '', 'joi');
    } else f = toField(interp, value, '');
    if (!f) continue;
    const children = f.type === 'object' ? f.children || [] : [];
    for (const c of children) {
      const i = out.findIndex((x) => x.name === c.name);
      if (i >= 0) out[i] = c; else out.push(c);
    }
  }
  return out;
}

function mergeFieldLists(primary, secondary) {
  const out = primary.map(cloneField);
  for (const f of secondary) if (!out.some((x) => x.name === f.name)) out.push(cloneField(f));
  return out;
}

function hasFileField(fields) {
  return fields.some((f) => f.type === 'file' || (f.type === 'array' && f.item && f.item.type === 'file'));
}

/** Pick the trees that apply to `method` (and optionally a raw path). */
function treesFor(col, method, rawPath) {
  const list = [];
  for (const t of col.trees.values()) {
    if (t.method && t.method !== method) continue;
    if (rawPath !== undefined && t.path && !(t.path.kind === rawPath.kind && t.path.value === rawPath.value)) continue;
    list.push(t);
  }
  return list;
}

function combinedTree(trees) {
  const empty = () => ({ children: new Map(), type: null, required: false, default: NONE, choices: new Set(), item: null, order: 0 });
  const out = { body: empty(), query: empty(), headers: new Map(), files: new Map() };
  for (const t of trees) {
    mergeNode(out.body, t.body);
    mergeNode(out.query, t.query);
    if (t.body.input) out.body.input = true;
    for (const [k, h] of t.headers) if (!out.headers.has(k)) out.headers.set(k, h);
    for (const [k, f] of t.files) out.files.set(k, f);
  }
  return out;
}

const STANDARD_HEADERS = /^(content-type|accept|user-agent|host|content-length|cookie|origin|referer|connection|accept-encoding|accept-language|x-forwarded-.*|x-real-ip|if-none-match|if-modified-since|cache-control|pragma|upgrade|authorization|x-request-id|x-requested-with|x-csrf-token|x-xsrf-token|stripe-signature|x-hub-signature(-256)?|sec-.*)$/i;

/**
 * Build request details for one route from the analysed chain.
 * @returns {{ body, query, headers, pathTypes, hints, protect, authKind, authHeader, tokenPrefix, unless, methodsSeen }}
 */
export function analyseChain(interp, flatRoute, method, cache, extra = {}) {
  const fw = extra.fw || flatRoute.fw;
  const route = new Collector(fw);
  const chain = flatRoute.chain.filter(Boolean);
  const mainIndex = chain.length - 1;
  let protect = false;
  let kind = null;
  let header = null;
  let prefix = null;
  let unless = null;
  const mainHints = new Set();
  for (let i = 0; i < chain.length; i++) {
    const v = chain[i];
    if (!v || (v.k !== 'f' && v.k !== 'p' && v.k !== 'u' && v.k !== 'ev' && v.k !== 'a')) continue;
    const items = v.k === 'a' ? v.items : [v];
    for (const item of items) {
      if (item.k === 'ev') { route.evChains = [...(route.evChains || []), item]; continue; }
      if (item.k !== 'f' && item.k !== 'p' && item.k !== 'u') continue;
      const col = analyseValue(interp, item, fw, flatRoute.meta, cache);
      mergeInto(route, col);
      if (col.wrapped) mergeInto(route, analyseValue(interp, col.wrapped, fw, flatRoute.meta, cache));
      const isMain = i === mainIndex;
      const hints = new Set([...col.hints, ...(col.wrapped ? analyseValue(interp, col.wrapped, fw, flatRoute.meta, cache).hints : [])]);
      if (isMain) for (const h of hints) mainHints.add(h);
      const named = item.k === 'f' ? item.name : item.k === 'u' ? item.name : '';
      const readsAuth = hints.has('authz-header') || hints.has('apikey') || hints.has('header-token');
      const isAuth = hints.has('protect') || (readsAuth && (!isMain || !hints.has('jwt-sign')))
        || (!isMain && (hints.has('named-auth') || (item.k === 'f' && authName(named) && !hints.has('login-strategy'))));
      if (isAuth) {
        protect = true;
        if (col.unless) unless = col.unless;
        if (hints.has('basic')) kind = 'basic';
        else if (hints.has('apikey')) { kind = kind || 'apikey'; header = header || col.authHeader; } else if (hints.has('header-token')) { kind = kind || 'header'; header = header || col.authHeader; } else if (hints.has('token')) { kind = kind || 'token'; prefix = col.tokenPrefix; } else if (hints.has('session') && !hints.has('bearer') && !hints.has('authz-header')) kind = kind || 'session';
        else if (hints.has('bearer') || hints.has('jwt') || hints.has('authz-header')) kind = kind || 'bearer';
      }
      if (hints.has('login-strategy')) mainHints.add('login-strategy');
    }
  }
  // express-jwt .unless({ path: [...] })
  if (protect && unless && unless.k === 'o') {
    const paths = unless.props.get('path');
    const list = paths && paths.k === 'a' ? paths.items : paths ? [paths] : [];
    for (const it of list) {
      if (it.k === 's' && joinPath(it.v) === flatRoute.fullPath) protect = false;
      else if (it.k === 're') {
        try { if (new RegExp(it.source, it.flags).test(flatRoute.fullPath)) protect = false; } catch { /* ignore */ }
      } else if (it.k === 'o') {
        const u = it.props.get('url');
        if (u && u.k === 's' && joinPath(u.v) === flatRoute.fullPath) protect = false;
      }
    }
  }
  return { col: route, protect, kind, header, prefix, mainHints };
}

/** Fields for one method from an analysed collector plus declared schemas. */
export function buildRequest(interp, col, method, opts = {}) {
  const trees = treesFor(col, method, opts.rawCond);
  const t = combinedTree(trees);
  const declared = {
    body: [...schemaFields(interp, col.schemas, 'body'), ...(opts.schemaBody || [])],
    query: [...schemaFields(interp, col.schemas, 'query'), ...(opts.schemaQuery || [])],
    params: [...schemaFields(interp, col.schemas, 'params'), ...(opts.schemaParams || [])],
    headers: [...schemaFields(interp, col.schemas, 'headers'), ...(opts.schemaHeaders || [])],
  };
  if (col.evChains && col.evChains.length) {
    const ev = evFields(col.evChains);
    declared.body = mergeFieldLists(declared.body, ev.body);
    declared.query = mergeFieldLists(declared.query, ev.query);
    declared.params = mergeFieldLists(declared.params, ev.params);
    declared.headers = mergeFieldLists(declared.headers, ev.headers);
  }
  const typed = { body: col.types.filter((x) => x.loc === 'body').flatMap((x) => x.fields), query: col.types.filter((x) => x.loc === 'query').flatMap((x) => x.fields) };
  const inferredBody = treeFields(t.body);
  const inferredQuery = treeFields(t.query);
  const isInput = !!t.body.input;

  // Body
  let bodyFields = [];
  let partial = false;
  if (declared.body.length) bodyFields = declared.body;
  else if (typed.body.length) bodyFields = mergeFieldLists(typed.body, []);
  else { bodyFields = inferredBody; partial = true; }
  // Adonis request.input(): body for writes, query string for reads
  let queryFields = declared.query.length ? declared.query : typed.query.length ? typed.query : inferredQuery;
  const readMethod = ['GET', 'HEAD', 'DELETE', 'OPTIONS'].includes(method);
  if (isInput && readMethod && partial) {
    queryFields = mergeFieldLists(queryFields, bodyFields.map((f) => ({ ...f, required: false })));
    bodyFields = [];
  }
  for (const [name, info] of t.files) {
    if (!bodyFields.some((f) => f.name === name)) bodyFields.push(newField(name, info.many ? 'array' : 'file', { required: true, item: info.many ? newField(name, 'file') : null }));
  }
  let mode = col.mode || 'json';
  if (opts.mode) mode = opts.mode;
  if (hasFileField(bodyFields) || t.files.size) mode = 'form';
  let body = null;
  const touchedBody = t.body.children.size || t.body.touched || col.schemas.some((s) => s.loc === 'body') || typed.body.length || t.files.size || col.hints.has('multipart');
  const bodyRead = bodyFields.length || touchedBody || opts.bodyRead;
  if (bodyRead && !(readMethod && !bodyFields.length) && !(method === 'GET' || method === 'HEAD')) {
    body = newBody(mode, bodyFields, { partial: partial && bodyFields.length > 0 });
    if (!bodyFields.length && mode === 'json' && !col.hints.has('raw-body')) body.example = {};
    if (!bodyFields.length && col.hints.has('raw-body')) body.mode = 'raw';
  }
  // Query
  const query = queryFields.map((f) => {
    const c = cloneField(f);
    if (c.type === 'object' && !(c.children || []).length) c.type = 'string';
    return c;
  });
  // Headers: custom ones the handler reads (auth headers are handled by collection auth)
  const headers = [];
  for (const f of declared.headers) if (!STANDARD_HEADERS.test(f.name) && !(opts.authHeader && f.name.toLowerCase() === opts.authHeader.toLowerCase())) headers.push(f);
  for (const [name] of t.headers) {
    if (STANDARD_HEADERS.test(name) || APIKEY_HEADER.test(name) || headers.some((h) => h.name.toLowerCase() === name)) continue;
    if (opts.authHeader && name === opts.authHeader.toLowerCase()) continue;
    if (/^(x-)?(access|auth)[-_]?token$|^token$/i.test(name)) continue;
    headers.push(newField(name, 'string', { required: true }));
  }
  return { body, query, headers, params: declared.params, pathTypes: col.pathTypes };
}

// --- route metadata ------------------------------------------------------------------------------

export function commentText(node) {
  const comments = (node && node.leadingComments) || [];
  if (!comments.length) return '';
  const c = comments[comments.length - 1];
  let text = c.value;
  if (c.type === 'CommentBlock') text = text.replace(/^\*+/, '').split('\n').map((l) => l.replace(/^\s*\*\s?/, '')).join('\n');
  else {
    // consecutive line comments
    const lines = [];
    for (let i = comments.length - 1; i >= 0 && comments[i].type === 'CommentLine'; i--) lines.unshift(comments[i].value.replace(/^\s?/, ''));
    text = lines.join('\n');
  }
  return text.trim();
}

/** Parse "@desc …", "@route GET /x", "@access Private", "@summary …" style comments. */
export function parseDoc(text) {
  const out = { summary: '', description: '', access: '' };
  if (!text) return out;
  const lines = text.split('\n');
  const free = [];
  for (const line of lines) {
    const m = /^@(\w+)\s*(.*)$/.exec(line.trim());
    if (m) {
      const tag = m[1].toLowerCase();
      if (tag === 'desc' || tag === 'description') out.description = (out.description ? out.description + ' ' : '') + m[2].trim();
      else if (tag === 'summary' || tag === 'name' || tag === 'title') out.summary = m[2].trim();
      else if (tag === 'access') out.access = m[2].trim().toLowerCase();
    } else if (!/^(eslint|istanbul|@ts-|prettier|TODO|FIXME|NOTE)/i.test(line.trim())) free.push(line);
  }
  const rest = free.join('\n').trim();
  if (!out.description) out.description = rest;
  if (!out.summary) {
    const first = (out.description || '').split(/\n|(?<=\.)\s/)[0].trim().replace(/\.$/, '');
    if (first && first.length <= 70 && !/^(GET|POST|PUT|PATCH|DELETE)\s+\//.test(first)) out.summary = first;
  }
  return out;
}

const GENERIC_NAMES = /^(handler|handle|anonymous|default|fn|cb|callback|middleware|async|main|index|route|controller|wrapper|wrapped|exec|run|action|bound .*)$/i;

export function nameFromHandler(v) {
  if (!v) return '';
  const name = (v.k === 'f' && (v.name || '')) || '';
  if (!name || GENERIC_NAMES.test(name) || /^\d/.test(name) || name.length < 3) return '';
  return humanize(name.replace(/(Handler|Controller|Route)$/, '')) || '';
}

const CRUD_VERBS = { list: 'List', index: 'List', find: 'List', findall: 'List', getall: 'List', all: 'List', get: 'Get', show: 'Get', findone: 'Get', findbyid: 'Get', getbyid: 'Get', read: 'Get', retrieve: 'Get', detail: 'Get', create: 'Create', store: 'Create', add: 'Create', post: 'Create', new: 'Create', insert: 'Create', update: 'Update', edit: 'Update', put: 'Update', patch: 'Update', modify: 'Update', delete: 'Delete', destroy: 'Delete', remove: 'Delete', del: 'Delete' };

function resourceWords(path) {
  const parts = path.split('/').filter((p) => p && !/^\{.*\}$/.test(p) && !/^(api|v\d+(\.\d+)?|rest)$/i.test(p));
  return parts.length ? parts[parts.length - 1] : '';
}

function singularWord(w) {
  if (/ies$/i.test(w)) return w.slice(0, -3) + 'y';
  if (/(ss|x|ch|sh)es$/i.test(w)) return w.slice(0, -2);
  if (/s$/i.test(w) && !/(ss|us|is)$/i.test(w)) return w.slice(0, -1);
  return w;
}

/** A readable request name: handler name, CRUD verb + resource, or "METHOD /path". */
export function routeName(method, path, handlerName) {
  const endsWithParam = /\}$/.test(path);
  const noun = resourceWords(path);
  const verb = handlerName ? CRUD_VERBS[handlerName.toLowerCase().replace(/\s+/g, '')] : null;
  if (handlerName && !verb) return handlerName;
  const words = noun ? humanize(noun).toLowerCase() : '';
  const one = singularWord(words);
  if (verb) return words ? `${verb} ${verb === 'List' ? words : one}` : verb;
  if (!noun) return `${method} ${path}`;
  const lastIsNoun = path.split('/').filter(Boolean).pop() === noun;
  if (!lastIsNoun && !endsWithParam) return `${method} ${path}`;
  switch (method) {
    case 'GET': return endsWithParam ? `Get ${one}` : `List ${words}`;
    case 'POST': return endsWithParam ? `${method} ${path}` : lastIsNoun && /^(login|logout|register|signup|signin|refresh|verify|reset|forgot)/i.test(noun) ? humanize(noun) : `Create ${one}`;
    case 'PUT': case 'PATCH': return endsWithParam ? `Update ${one}` : `Update ${words}`;
    case 'DELETE': return endsWithParam ? `Delete ${one}` : `Delete ${words}`;
    default: return `${method} ${path}`;
  }
}

export function mainHandler(chain) {
  for (let i = chain.length - 1; i >= 0; i--) {
    const v = chain[i];
    if (v && v.k === 'f') return v;
    if (v && v.k === 'p') {
      const inner = v.chain.filter((c) => 'call' in c).flatMap((c) => c.call).find((a) => a && a.k === 'f');
      if (inner) return inner;
    }
  }
  return null;
}

export { jsValue, jsonSchemaOf, newRoute };
