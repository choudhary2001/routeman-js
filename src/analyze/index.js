// Orchestration: run the analysers that apply to a project and build the routeman API model.
import fs from 'node:fs';
import path from 'node:path';
import { api as newApi, route as newRoute, field as newField, NONE, cloneField } from '../model.js';
import { humanize, joinPath } from '../naming.js';
import { Interp } from './interp.js';
import { Resolver } from './resolve.js';
import { makeHooks } from './hooks.js';
import { flatten, analyseChain, buildRequest, commentText, parseDoc, nameFromHandler, mainHandler, normalizePath, routeName } from './routes.js';
import { toField } from './schemas.js';
import { jsValue, U } from './values.js';
import { detectFrameworks, findEntries, listSources, loadEnv, packageInfo, FILE_ROUTED, DECORATED } from '../project.js';
import { decoratedRoutes } from '../frameworks/decorators.js';
import { fileRoutes } from '../frameworks/filesystem.js';
import { modelFields } from './orm.js';

const LOGIN_PATH = /(^|\/)(login|log-in|log_in|signin|sign-in|sign_in|token|obtain[-_]?token|authenticate|jwt(\/create)?|auth\/token|access[-_]?token|session|sessions)\/?$/i;
const NOT_LOGIN = /refresh|verify|logout|log-out|signout|sign-out|revoke|reset|register|signup|sign-up|forgot|otp\/send|change|confirm/i;
const DEFAULT_PORTS = { next: 3000, nuxt: 3000, nitro: 3000, sveltekit: 5173, astro: 4321, adonis: 3333, oak: 8000, deno: 8000, hono: 3000, elysia: 3000, remix: 3000 };
const CALL_STYLE_PKGS = /from\s+['"](express|fastify|koa|@koa\/router|koa-router|hono|elysia|@hapi\/hapi|restify|polka|@tinyhttp\/app|hyper-express|ultimate-express|itty-router|h3|express-promise-router|@oakserver\/oak|@oak\/oak|jsr:@oak\/oak|npm:express[^'"]*|npm:hono[^'"]*|@adonisjs\/core\/services\/router|@feathersjs\/[a-z]+|next-connect)['"]|require\(\s*['"](express|fastify|koa|@koa\/router|koa-router|hono|@hapi\/hapi|restify|polka|hyper-express|ultimate-express|express-promise-router|itty-router|h3|@feathersjs\/[a-z]+)['"]\s*\)|Bun\.serve\(|Deno\.serve\(|createServer\(/;

/**
 * @param {object} opts
 * @param {string} opts.root
 * @param {string} [opts.framework]  'auto' or a framework id
 * @param {string[]} [opts.entries]   entry files (relative to root)
 * @param {string[]} [opts.exclude]   regexes of paths to leave out
 * @param {string} [opts.envFile]
 * @param {(msg: string) => void} [opts.log]
 */
export function analyze(opts) {
  const root = path.resolve(opts.root);
  const env = loadEnv(root, opts.envFile);
  const detected = detectFrameworks(root);
  const framework = opts.framework && opts.framework !== 'auto' ? opts.framework : detected[0] || 'node';
  const resolver = new Resolver(root);
  const interp = new Interp({ root, resolver, env, hooks: makeHooks(), log: opts.log });
  interp.state = { authPlugins: new Set(), hapiStrategies: new Map(), nest: {}, autoImports: ['nuxt', 'nitro'].includes(framework) };
  const { deps } = packageInfo(root);
  const out = newApi(framework);
  out.idStyle = deps.mongoose || deps['@typegoose/typegoose'] ? 'objectid' : prismaUuid(root) ? 'uuid' : 'integer';
  const sources = listSources(root);
  const want = new Set([framework, ...detected]);
  const cache = new Map();
  const built = [];

  // 1. decorator frameworks (NestJS, routing-controllers, tsoa, inversify, LoopBack)
  if ([...want].some((f) => DECORATED.has(f)) || opts.framework === 'auto' || !opts.framework) {
    built.push(...decoratedRoutes(interp, root, sources, want, cache));
  }
  // 2. file-system routing (Next.js, Nuxt/Nitro, SvelteKit, Astro, Remix)
  if ([...want].some((f) => FILE_ROUTED.has(f))) {
    built.push(...fileRoutes(interp, root, want, cache, analyseFlat));
  }
  // 3. call-style frameworks from the entry files
  {
    const entries = (opts.entries && opts.entries.length ? opts.entries.map((e) => path.resolve(root, e)) : findEntries(root)).filter((f) => fs.existsSync(f));
    for (const file of entries) interp.loadModule(file);
    let flat = flatten(interp);
    const reached = new Set(interp.modules.keys());
    // Routers in files the entry never reached (auto-loaded with dynamic paths, serverless handlers, ...)
    const unreached = sources.filter((f) => !reached.has(f) && quickMatch(f));
    if (unreached.length && (!flat.routes.length || unreached.length <= 400)) {
      const before = new Set(interp.routers);
      for (const f of unreached) interp.loadModule(f);
      const fresh = interp.routers.filter((r) => !before.has(r));
      flat = flatten(interp);
      if (fresh.length && flat.routes.some((r) => fresh.includes(r.rootRouter) && !r.rootRouter.isApp) && entries.length) {
        const files = [...new Set(flat.routes.filter((r) => fresh.includes(r.rootRouter) && !r.rootRouter.isApp).map((r) => (r.where || '').split(':')[0]))].slice(0, 5);
        out.warnings.push(`routes in ${files.join(', ')} are not mounted from the entry file; they are listed without a mount prefix`);
      }
    }
    for (const fr of flat.routes) built.push(...analyseFlat(interp, fr, cache));
    for (const raw of flat.raws) built.push(...analyseRaw(interp, raw, cache));
  }

  // Websockets, port, warnings
  for (const w of interp.websockets) if (!out.websockets.some((x) => x.path === w.path)) out.websockets.push({ path: normalizePath(w.path).path, description: w.description || '', source: w.where || '' });
  out.port = interp.ports.find((p) => p > 0 && p < 65536) || (env.has('PORT') && /^\d+$/.test(env.get('PORT')) ? Number(env.get('PORT')) : DEFAULT_PORTS[framework] || 3000);
  out.warnings.push(...interp.warnings, ...interp.parseErrors.map((e) => `could not parse ${e}`));

  // Exclusions and duplicates
  const excludes = (opts.exclude || []).map((x) => new RegExp(x));
  const seen = new Map();
  for (const r of built) {
    if (excludes.some((re) => re.test(r.path))) continue;
    const key = r.method + ' ' + r.path;
    const prev = seen.get(key);
    if (!prev) { seen.set(key, r); continue; }
    const richness = (x) => (x.body ? x.body.fields.length + 1 : 0) + x.query.length;
    if (richness(r) > richness(prev)) seen.set(key, { ...r, _protect: r._protect || prev._protect });
  }
  out.routes = [...seen.values()];
  decideAuth(out, interp, deps);
  for (const r of out.routes) cleanup(r);
  return out;
}

function prismaUuid(root) {
  for (const p of ['prisma/schema.prisma', 'schema.prisma']) {
    try {
      const s = fs.readFileSync(path.join(root, p), 'utf8');
      return /@id\s+@default\((uuid|cuid)\(\)\)/.test(s) || /@default\((uuid|cuid)\(\)\)\s+@id/.test(s);
    } catch { /* none */ }
  }
  return false;
}

function quickMatch(file) {
  try {
    const st = fs.statSync(file);
    if (st.size > 512 * 1024) return false;
    return CALL_STYLE_PKGS.test(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
}

// --- per-framework route options ---------------------------------------------------------------

function fieldsOf(interp, v, lib) {
  if (!v) return [];
  const f = toField(interp, v, '', lib);
  if (f && f.type === 'object') return f.children || [];
  return [];
}

function prop(o, key) {
  return o && o.k === 'o' ? o.props.get(key) : undefined;
}

function frameworkOptions(interp, fr) {
  const extra = { schemaBody: [], schemaQuery: [], schemaParams: [], schemaHeaders: [], hooks: [], summary: '', description: '', tags: [], public: null, mode: null };
  const o = fr.opts;
  if (fr.fw === 'fastify' && o) {
    const schema = prop(o, 'schema');
    if (schema && schema.k === 'o') {
      extra.schemaBody = fieldsOf(interp, prop(schema, 'body'));
      extra.schemaQuery = fieldsOf(interp, prop(schema, 'querystring') || prop(schema, 'query'));
      extra.schemaParams = fieldsOf(interp, prop(schema, 'params'));
      extra.schemaHeaders = fieldsOf(interp, prop(schema, 'headers'));
      const s = jsValue(schema) || {};
      extra.summary = typeof s.summary === 'string' ? s.summary : '';
      extra.description = typeof s.description === 'string' ? s.description : '';
      extra.tags = Array.isArray(s.tags) ? s.tags.filter((x) => typeof x === 'string') : [];
      if (Array.isArray(s.consumes) && s.consumes.includes('multipart/form-data')) extra.mode = 'form';
      if (Array.isArray(s.security) && !s.security.length) extra.public = true;
    }
    for (const key of ['onRequest', 'preValidation', 'preHandler']) {
      const h = prop(o, key);
      if (h) extra.hooks.push(...(h.k === 'a' ? h.items : [h]));
    }
  }
  if (fr.fw === 'elysia') {
    const models = fr.router && fr.router.models;
    const resolve = (v) => (v && v.k === 's' && models && models.get(v.v)) || v;
    for (const hook of [...(fr.guards || []), o].filter((x) => x && x.k === 'o')) {
      const b = fieldsOf(interp, resolve(prop(hook, 'body')));
      if (b.length) extra.schemaBody = b;
      const q = fieldsOf(interp, resolve(prop(hook, 'query')));
      if (q.length) extra.schemaQuery = q;
      const p = fieldsOf(interp, resolve(prop(hook, 'params')));
      if (p.length) extra.schemaParams = p;
      const h = fieldsOf(interp, resolve(prop(hook, 'headers')));
      if (h.length) extra.schemaHeaders = h;
      for (const key of ['beforeHandle', 'onBeforeHandle', 'derive', 'resolve']) {
        const v = prop(hook, key);
        if (v) extra.hooks.push(...(v.k === 'a' ? v.items : [v]));
      }
      const detail = prop(hook, 'detail');
      if (detail && detail.k === 'o') {
        const d = jsValue(detail);
        if (typeof d.summary === 'string') extra.summary = d.summary;
        if (typeof d.description === 'string') extra.description = d.description;
        if (Array.isArray(d.tags)) extra.tags = d.tags.filter((x) => typeof x === 'string');
        if (Array.isArray(d.security) && !d.security.length) extra.public = true;
      }
      const type = prop(hook, 'type');
      if (type && type.k === 's') extra.mode = /multipart|formdata/i.test(type.v) ? 'form' : /urlencoded/i.test(type.v) ? 'urlencoded' : null;
    }
  }
  if (fr.fw === 'hapi' && o) {
    const validate = prop(o, 'validate');
    if (validate && validate.k === 'o') {
      extra.schemaBody = fieldsOf(interp, prop(validate, 'payload'), 'joi');
      extra.schemaQuery = fieldsOf(interp, prop(validate, 'query'), 'joi');
      extra.schemaParams = fieldsOf(interp, prop(validate, 'params'), 'joi');
      extra.schemaHeaders = fieldsOf(interp, prop(validate, 'headers'), 'joi');
    }
    const auth = prop(o, 'auth');
    const root = fr.rootRouter;
    if (auth && auth.k === 'b' && !auth.v) extra.public = true;
    else if (auth && auth.k === 's' && auth.v === 'none') extra.public = true;
    else if (auth && (auth.k === 's' || auth.k === 'o')) {
      const mode = prop(auth, 'mode');
      if (mode && mode.k === 's' && (mode.v === 'try' || mode.v === 'optional')) extra.public = true;
      else extra.protectedBy = auth.k === 's' ? auth.v : 'default';
    } else if (root && root.defaultAuth) extra.protectedBy = root.defaultAuth;
    const d = jsValue(o) || {};
    if (typeof d.description === 'string') extra.summary = d.description;
    if (typeof d.notes === 'string') extra.description = d.notes;
    if (Array.isArray(d.tags)) extra.tags = d.tags.filter((x) => typeof x === 'string' && x !== 'api');
    const payload = d.payload || {};
    if (payload.multipart || /multipart/.test(String(payload.allow || ''))) extra.mode = 'form';
  }
  if (fr.meta && fr.meta.openapi && o) {
    const req = prop(o, 'request');
    if (req && req.k === 'o') {
      extra.schemaParams = fieldsOf(interp, prop(req, 'params'));
      extra.schemaQuery = fieldsOf(interp, prop(req, 'query'));
      extra.schemaHeaders = fieldsOf(interp, prop(req, 'headers'));
      const content = prop(prop(req, 'body'), 'content');
      if (content && content.k === 'o') {
        for (const [mime, media] of content.props) {
          const schema = prop(media, 'schema');
          const f = fieldsOf(interp, schema);
          if (f.length) {
            extra.schemaBody = f;
            if (/multipart/.test(mime)) extra.mode = 'form';
            else if (/urlencoded/.test(mime)) extra.mode = 'urlencoded';
            break;
          }
        }
      }
    }
    const d = jsValue(o) || {};
    if (typeof d.summary === 'string') extra.summary = d.summary;
    if (typeof d.description === 'string') extra.description = d.description;
    if (Array.isArray(d.tags)) extra.tags = d.tags.filter((x) => typeof x === 'string');
    if (Array.isArray(d.security)) { if (!d.security.length) extra.public = true; else extra.protectedBy = 'openapi'; }
    const mws = prop(o, 'middleware');
    if (mws) extra.hooks.push(...(mws.k === 'a' ? mws.items : [mws]));
  }
  return extra;
}

// --- analysing flattened routes ------------------------------------------------------------------

function methodsFor(fr, res) {
  const list = fr.methods.flatMap((m) => (m === 'ALL' || m === 'ANY' || m === '*' ? ['ALL'] : [m]));
  if (!list.includes('ALL')) return [...new Set(list)];
  const seen = [...new Set(res.col.conds.filter((c) => c.method).map((c) => c.method))].filter((m) => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(m));
  if (seen.length) return seen;
  const reads = [...res.col.trees.values()].some((t) => t.body.children.size || t.body.touched) || res.col.schemas.some((s) => s.loc === 'body') || res.col.types.some((t) => t.loc === 'body');
  return reads ? ['POST'] : ['GET'];
}

/** Analyse a flattened route (also used for file-routed handlers). */
export function analyseFlat(interp, fr, cache) {
  // 404 catch-alls: app.all('*'), app.all('*splat'), router.all('/{*rest}')
  const wildcard = fr.rawPath !== undefined ? /\*/.test(fr.rawPath) : false;
  if ((wildcard || /\/\{(path|splat|rest|all|any|wildcard|catchAll|_)\}$/.test(fr.fullPath)) && fr.methods.some((m) => /^(ALL|USE|OPTIONS)$/i.test(m))) return [];
  const extra = frameworkOptions(interp, fr);
  const chain = extra.hooks.length ? [...extra.hooks, ...fr.chain] : fr.chain;
  const flatRoute = { ...fr, chain };
  if (!chain.length && fr.fw !== 'bun') return [];
  const res = analyseChain(interp, flatRoute, null, cache);
  const methods = methodsFor(fr, res);
  const handler = mainHandler(chain);
  const doc = parseDoc(commentText(fr.node && fr.node.leadingComments ? fr.node : fr.stmt) || (handler && handler.node ? commentText(handler.node) || commentText(handler.node.__parentStmt) : ''));
  const out = [];
  for (const method of methods) {
    const req = buildRequest(interp, res.col, method, { mode: extra.mode, schemaBody: extra.schemaBody, schemaQuery: extra.schemaQuery, schemaParams: extra.schemaParams, schemaHeaders: extra.schemaHeaders, authHeader: res.header });
    ormBody(interp, res, req, method);
    const r = newRoute(fr.fullPath, method, {
      name: extra.summary || doc.summary || routeName(method, fr.fullPath, nameFromHandler(handler)),
      description: [extra.description || (doc.description !== doc.summary ? doc.description : '')].filter(Boolean).join('\n'),
      folder: extra.tags.length ? [extra.tags[0]] : fr.folder || [],
      query: req.query, headers: req.headers, body: req.body, source: fr.where || '',
    });
    r.pathParams = pathParams(fr, req, interp);
    let protect = res.protect;
    if (extra.protectedBy) protect = true;
    if (extra.public) protect = false;
    if (doc.access === 'public') protect = false;
    else if (/private|protected|admin|auth/.test(doc.access)) protect = true;
    r._protect = protect;
    r._kind = res.kind || (extra.protectedBy ? hapiKind(interp, extra.protectedBy) : null);
    r._header = res.header;
    r._prefix = res.prefix;
    r._hints = res.mainHints;
    out.push(r);
  }
  return out;
}

function hapiKind(interp, strategy) {
  const scheme = interp.state.hapiStrategies.get(strategy) || strategy;
  if (/basic/.test(scheme)) return 'basic';
  if (/cookie|session/.test(scheme)) return 'session';
  if (/api.?key/.test(scheme)) return 'apikey';
  return 'bearer';
}

/** Body fields from an ORM model when the handler passes req.body straight to it. */
function ormBody(interp, res, req, method) {
  if (!req.body || req.body.fields.length || !res.col.ormModels || !res.col.ormModels.length) return;
  const fields = modelFields(interp, res.col.ormModels[0]);
  if (fields && fields.length) {
    req.body.fields = method === 'PATCH' ? fields.map((f) => ({ ...f, required: false })) : fields;
    req.body.partial = false;
    req.body.example = NONE;
  }
}

function pathParams(fr, req, interp) {
  const out = [];
  for (const p of fr.params) {
    const declared = (req.params || []).find((x) => x.name === p.name);
    let f = declared ? cloneField(declared) : newField(p.name, p.type || 'string', { required: true });
    if (!declared && req.pathTypes && req.pathTypes.get(p.name)) f.type = req.pathTypes.get(p.name);
    f.required = true;
    out.push(f);
  }
  void interp;
  return out;
}

/** fetch / node:http handlers that route by comparing the URL and method themselves. */
function analyseRaw(interp, raw, cache) {
  const fr = { fullPath: raw.prefix || '/', params: [], methods: ['ALL'], chain: [...raw.chain, raw.handler], fw: raw.fw === 'node' ? 'node' : 'fetch', meta: {}, where: raw.where, router: raw.router };
  const res = analyseChain(interp, fr, null, cache);
  const out = [];
  const endpoints = new Map();
  for (const c of res.col.conds) {
    if (!c.path) continue;
    const p = rawPathOf(c.path);
    if (!p) continue;
    const key = (c.method || '*') + ' ' + p;
    endpoints.set(key, { path: p, method: c.method, cond: c.path });
  }
  // a method condition nested inside a path condition: combine
  const byPath = new Map();
  for (const t of res.col.trees.values()) {
    if (t.path && t.method) {
      const p = rawPathOf(t.path);
      if (!p) continue;
      byPath.set(t.method + ' ' + p, { path: p, method: t.method, cond: t.path });
    }
  }
  for (const [k, v] of byPath) endpoints.set(k, v);
  const final = new Map();
  for (const e of endpoints.values()) {
    if (!e.method) {
      const hasSpecific = [...endpoints.values()].some((x) => x.path === e.path && x.method);
      if (hasSpecific) continue;
    }
    final.set((e.method || 'GET') + ' ' + e.path, e);
  }
  for (const e of final.values()) {
    const method = e.method || 'GET';
    const rawPath = e.path.replace(/\/\{id\}$/, '/');
    const req = buildRequest(interp, res.col, method, { rawCond: e.cond });
    const { path: full, params } = normalizePath(joinPath(raw.prefix || '', e.path));
    const r = newRoute(full, method, { query: req.query, headers: req.headers, body: req.body, source: raw.where || '' });
    r.pathParams = params.map((p) => newField(p.name, p.type, { required: true }));
    if (e.path.endsWith('/{id}')) r.pathParams = [newField('id', 'string', { required: true })];
    const at = res.col.protectAt;
    const sameCond = (a, b) => !a || !b || (a.kind === b.kind && a.value === b.value);
    r._protect = at.some((x) => !x.method && !x.path) ? true
      : at.some((x) => (!x.method || x.method === method) && x.path && sameCond(x.path, e.cond)) || at.some((x) => x.method === method && !x.path);
    r._kind = res.kind || 'bearer';
    r._hints = res.mainHints;
    out.push(r);
  }
  return out;
}

/** '/api/todos' / prefix '/api/todos/' / regex ^\/api\/todos\/(\d+)$ -> path with {params}. */
function rawPathOf(cond) {
  if (cond.kind === 'eq') return cond.value.replace(/\/$/, '') || '/';
  if (cond.kind === 'prefix') return cond.value.replace(/\/$/, '') + '/{id}';
  if (cond.kind === 'regex') {
    let n = 0;
    let src = cond.value.replace(/^\^/, '').replace(/\$$/, '').replace(/\\\/\??$/, '').replace(/\/\?$/, '');
    src = src.replace(/\((\?<(\w+)>)?([^()]*)\)/g, (_, named, name) => `{${name || (n++ ? 'id' + n : 'id')}}`);
    src = src.replace(/\\\//g, '/').replace(/\\\./g, '.');
    if (/[\\[\]()*+?|^$]/.test(src)) return null;
    return src || '/';
  }
  return null;
}

// --- authentication ------------------------------------------------------------------------------

function decideAuth(a, interp, deps) {
  const prot = a.routes.filter((r) => r._protect);
  const counts = new Map();
  for (const r of prot) if (r._kind) counts.set(r._kind, (counts.get(r._kind) || 0) + 1);
  const best = [...counts].sort((x, y) => y[1] - x[1])[0];
  const pluginKind = [...interp.state.authPlugins][0];
  const depKind = deps.jsonwebtoken || deps.jose || deps['passport-jwt'] || deps['@nestjs/jwt'] || deps['express-jwt'] || deps['@fastify/jwt'] || deps['koa-jwt'] || deps['@elysiajs/jwt'] || deps['hapi-auth-jwt2'] || deps['@hapi/jwt'] || deps['better-auth'] || deps['@clerk/express'] || deps['firebase-admin']
    ? 'bearer' : deps['express-session'] || deps['cookie-session'] || deps['@fastify/session'] || deps['koa-session'] || deps['@adonisjs/session'] || deps['iron-session'] ? 'session' : deps['express-basic-auth'] || deps['basic-auth'] ? 'basic' : null;
  if (prot.length) {
    a.auth = best ? best[0] : pluginKind || depKind || 'bearer';
    for (const r of a.routes) r.auth = r._protect ? null : 'none';
    const sample = prot.find((r) => r._kind === a.auth) || prot[0];
    if (a.auth === 'apikey') a.authHeader = sample._header || 'x-api-key';
    if (a.auth === 'header') a.authHeader = sample._header || 'x-access-token';
    if (a.auth === 'token') a.tokenPrefix = sample._prefix || 'Token';
  } else {
    const issues = a.routes.some((r) => r._hints && (r._hints.has('jwt-sign') || r._hints.has('login-strategy')));
    if (issues || pluginKind) a.auth = pluginKind || (depKind === 'session' ? 'session' : 'bearer');
    else if (depKind === 'bearer') a.auth = 'bearer';
    else a.auth = 'none';
  }
  // routes protected by a different scheme than the collection default (e.g. an x-api-key admin router)
  if (prot.length && ['bearer', 'token', 'header', 'session'].includes(a.auth)) {
    for (const r of prot) {
      if (r._kind === 'apikey' && a.auth !== 'apikey') r.auth = `apikey:${r._header || 'x-api-key'}`;
      else if (r._kind === 'basic' && a.auth !== 'basic') r.auth = 'basic';
    }
  }
  // login request
  if (['bearer', 'token', 'header', 'session'].includes(a.auth)) {
    const cands = [];
    for (const r of a.routes) {
      if (r.method !== 'POST' || NOT_LOGIN.test(r.path)) continue;
      const hasPassword = r.body && r.body.fields.some((f) => /pass(word)?|secret|otp|code|pin/i.test(f.name));
      const hints = r._hints || new Set();
      let rank = null;
      if ((hints.has('jwt-sign') || hints.has('session-login')) && (hasPassword || LOGIN_PATH.test(r.path))) rank = 0;
      else if (hints.has('login-strategy')) rank = 0;
      else if (LOGIN_PATH.test(r.path) && hasPassword) rank = 1;
      else if (LOGIN_PATH.test(r.path) && /login|signin|sign-in|token/i.test(r.path)) rank = 2;
      if (rank !== null) cands.push([rank, r]);
    }
    cands.sort((x, y) => x[0] - y[0] || x[1].path.length - y[1].path.length);
    if (cands.length) {
      const login = cands[0][1];
      login.isLogin = a.auth !== 'session';
      login.auth = 'none';
      a.loginPath = login.path;
    }
    if (a.auth !== 'session') {
      for (const r of a.routes) {
        if (/refresh/i.test(r.path) && r.method === 'POST' && !(r.body && r.body.fields.some((f) => /refresh/i.test(f.name)))) r.auth = r.auth === 'none' && !r._protect ? 'refresh' : r.auth;
      }
    }
  }
  if (a.auth === 'session') for (const r of a.routes) r.auth = null;
}

function cleanup(r) {
  delete r._protect;
  delete r._kind;
  delete r._header;
  delete r._prefix;
  delete r._hints;
  if (!r.name) r.name = '';
}

export { humanize, U };
