import fs from 'node:fs';
import path from 'node:path';
// Composes the interpreter hooks from built-ins, frameworks, schema libraries and handler roles.
import { U, unknown, str, pkg, pkgPath } from './values.js';
import { builtinPkgCall, builtinPkgGet } from './builtins.js';
import { schemaPkgCall, schemaMethod, schemaGet, evMethodHook, validateCall } from './schemas.js';
import { roleHooks, role } from './roles.js';
import { classValueFields, typeToField } from './ts-types.js';
import { routerMethod, routerGet, routerPkgCall, makeRouter } from '../frameworks/routers.js';
import { ormPkgCall, ormObjectCall, ormStaticInit } from './orm.js';
import { UNDEF } from './values.js';

const H3_UTILS = new Set(['defineEventHandler', 'eventHandler', 'defineCachedEventHandler', 'cachedEventHandler', 'defineHandler', 'readBody',
  'readRawBody', 'getQuery', 'getRouterParam', 'getRouterParams', 'readValidatedBody', 'getValidatedQuery', 'getValidatedRouterParams',
  'readMultipartFormData', 'readFormData', 'getHeader', 'getRequestHeader', 'getHeaders', 'getRequestHeaders', 'createError', 'isMethod',
  'assertMethod', 'getMethod', 'setResponseStatus', 'sendRedirect', 'getCookie', 'requireUserSession', 'getUserSession', 'defineWebSocketHandler',
  'useRuntimeConfig', 'useStorage', 'getRequestURL', 'readBodySafe', 'defineLazyEventHandler', 'lazyEventHandler']);
const GLOBAL_CTORS = new Set(['URL', 'Map', 'Set', 'URLSearchParams']);

function adonisRouter(interp) {
  if (!interp.state.adonisRouter) interp.state.adonisRouter = makeRouter(interp, 'adonis', null, { isApp: true });
  return interp.state.adonisRouter;
}

/** h3 / Nitro / Nuxt utilities called with the event. */
function h3Call(interp, name, args) {
  const col = interp.analyzing;
  const ev = args[0];
  if (!col || !ev || ev.k !== 'role') return undefined;
  const runValidator = (validator, target) => {
    if (!validator) return target;
    if (validator.k === 'z') { col.schemas.push({ loc: target.loc, value: validator }); return target; }
    if (validator.k === 'nf' && validator.schema) { col.schemas.push({ loc: target.loc, value: validator.schema }); return target; }
    if (validator.k === 'f') interp.callFunction(validator, [target], undefined, null);
    return target;
  };
  const root = (loc) => { col.touch(loc, []); return { k: 'role', role: 'field', col, loc, path: [] }; };
  switch (name) {
    case 'readBody': case 'readBodySafe': return root('body');
    case 'readRawBody': col.hints.add('raw-body'); return U;
    case 'readValidatedBody': return runValidator(args[1], root('body'));
    case 'getQuery': return root('query');
    case 'getValidatedQuery': return runValidator(args[1], root('query'));
    case 'getRouterParam': return args[1] && args[1].k === 's' ? { k: 'role', role: 'param', col, name: args[1].v, path: [args[1].v] } : U;
    case 'getRouterParams': case 'getValidatedRouterParams': return role('params', col);
    case 'getHeader': case 'getRequestHeader': {
      const h = args[1] && args[1].k === 's' ? args[1].v : null;
      if (!h) return U;
      col.touch('headers', [h]);
      return { k: 'role', role: 'header', col, name: h.toLowerCase(), path: [h] };
    }
    case 'getHeaders': case 'getRequestHeaders': return role('headers', col);
    case 'readMultipartFormData': col.mode = 'form'; col.hints.add('multipart'); return U;
    case 'readFormData': col.mode = 'form'; return role('formData', col);
    case 'getMethod': return role('method', col);
    case 'getRequestURL': return role('urlObj', col);
    case 'isMethod': {
      const m = args[1];
      if (m && m.k === 's') return { k: 'cond', method: m.v.toUpperCase() };
      return U;
    }
    case 'assertMethod': {
      const m = args[1];
      const list = m && m.k === 'a' ? m.items : m ? [m] : [];
      const first = list.find((x) => x.k === 's');
      if (first) {
        col.enter({ method: first.v.toUpperCase(), path: null });
      }
      return U;
    }
    case 'requireUserSession': col.hints.add('protect'); col.hints.add('session'); return U;
    case 'getUserSession': col.hints.add('reads-user'); return U;
    default: return undefined;
  }
}

/** Express's `Request<Params, ResBody, ReqBody, Query>` and `req.body as Dto` / `const x: Dto = req.body`. */
function onTyped(interp, v, annotation, scope) {
  const col = interp.analyzing;
  if (!col || !annotation) return v;
  const t = annotation.typeAnnotation || annotation;
  const rec = interp.modOf(scope);
  const ctx = { interp, rec, depth: 0, seen: new Set() };
  if (v.role === 'field') {
    if (!v.path.length && (v.loc === 'body' || v.loc === 'query' || v.loc === 'form')) {
      const f = typeToField(t, '', ctx);
      if (f.children && f.children.length) col.types.push({ loc: v.loc === 'form' ? 'body' : v.loc, fields: f.children });
    } else if (v.path.length) {
      const f = typeToField(t, '', ctx);
      if (f.type && f.type !== 'any' && f.type !== 'object') col.setType(v.loc, v.path, f.type, f.type === 'file');
      if (f.type === 'file') col.mode = 'form';
    }
    return v;
  }
  if (v.role === 'req' && t.type === 'TSTypeReference') {
    const name = t.typeName && (t.typeName.name || (t.typeName.right && t.typeName.right.name));
    const params = (t.typeParameters || t.typeArguments || { params: [] }).params;
    if (name === 'Request' && params.length >= 3) {
      const body = typeToField(params[2], '', ctx);
      if (body.children && body.children.length) col.types.push({ loc: 'body', fields: body.children });
      if (params[3]) {
        const q = typeToField(params[3], '', ctx);
        if (q.children && q.children.length) col.types.push({ loc: 'query', fields: q.children });
      }
    } else if (name && name !== 'Request' && name !== 'FastifyRequest') {
      // interface CreateUserRequest extends Request { body: {...} }
      const f = typeToField(t, '', ctx);
      for (const c of f.children || []) {
        if ((c.name === 'body' || c.name === 'query') && c.children && c.children.length) col.types.push({ loc: c.name, fields: c.children });
      }
    } else if (name === 'FastifyRequest' && params[0]) {
      const generic = typeToField(params[0], '', ctx);
      for (const c of generic.children || []) {
        const loc = c.name === 'Body' ? 'body' : c.name === 'Querystring' ? 'query' : null;
        if (loc && c.children && c.children.length) col.types.push({ loc, fields: c.children });
      }
    }
  }
  return v;
}

/** Nuxt / Nitro auto-imports: exports of server/utils/** and utils/** are globals. */
function autoImport(interp, name) {
  if (!interp.state.autoImportMap) {
    const map = new Map();
    interp.state.autoImportMap = map;
    for (const dir of ['server/utils', 'utils', 'server/composables']) {
      const base = path.join(interp.root, dir);
      const files = [];
      const walk = (d, rel, depth) => {
        let names = [];
        try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const n of names) {
          if (n.isDirectory() && depth < 6) walk(path.join(d, n.name), path.join(rel, n.name), depth + 1);
          else if (n.isFile()) files.push(path.join(rel, n.name));
        }
      };
      walk(base, '', 0);
      for (const f of files) {
        if (!/\.(c|m)?[jt]s$/.test(f) || /\.d\.ts$/.test(f)) continue;
        const rec = interp.loadModule(path.join(base, f));
        if (!rec || !rec.esm) continue;
        for (const n of interp.exportNames(rec)) if (!map.has(n)) map.set(n, () => interp.getExport(rec, n));
      }
    }
  }
  const get = interp.state.autoImportMap.get(name);
  return get ? get() : undefined;
}

/** plainToInstance(Dto, req.body), validate(schema, req.body), ...: a helper that applies a schema. */
function bodyWithSchema(interp, args) {
  const col = interp.analyzing;
  if (!col) return undefined;
  const target = args.find((a) => a && a.k === 'role' && a.role === 'field' && !a.path.length);
  const schema = args.find((a) => a && (a.k === 'z' || a.k === 'c'));
  if (target && schema) {
    col.schemas.push({ loc: target.loc === 'form' || target.loc === 'input' ? 'body' : target.loc, value: schema });
    return target;
  }
  return undefined;
}

export function makeHooks() {
  return {
    pkgImport(interp, name, imported) {
      if ((name === '@adonisjs/core/services/router' || name === '@ioc:Adonis/Core/Route') && (imported === 'default' || imported === '*')) return adonisRouter(interp);
      if ((name === 'h3' || name === 'nitropack/runtime' || name === '#imports' || name === 'nitro/runtime') && H3_UTILS.has(imported)) return pkg('h3', [{ get: imported }]);
      return undefined;
    },
    pkgGet(interp, p, key) {
      // mongoose.models.User || mongoose.model('User', schema)
      if (p.pkg === 'mongoose' && p.chain.length && p.chain[p.chain.length - 1].get === 'models') return UNDEF;
      return builtinPkgGet(interp, p, key);
    },
    pkgCall(interp, p, args, isNew, node) {
      const z = schemaPkgCall(interp, p);
      if (z) return z;
      if (p.pkg === 'h3') {
        const sig = pkgPath(p).replace(/\(\)$/, '');
        if (H3_UTILS.has(sig)) {
          const v = h3Call(interp, sig, args);
          if (v) return v;
        }
      }
      const r = routerPkgCall(interp, p, args, isNew, node);
      if (r) return r;
      const m = ormPkgCall(interp, p, args, isNew);
      if (m) return m;
      const b = builtinPkgCall(interp, p, args, isNew, node);
      if (b) return b;
      return bodyWithSchema(interp, args);
    },
    global(interp, name) {
      if (GLOBAL_CTORS.has(name)) return pkg('#global', [{ get: name }]);
      if (interp.state.autoImports) {
        const v = autoImport(interp, name);
        if (v) return v;
      }
      if (interp.state.autoImports && H3_UTILS.has(name)) return pkg('h3', [{ get: name }]);
      if (interp.state.autoImports && name === 'z') return pkg('zod', []);
      return undefined;
    },
    routerMethod,
    routerGet,
    schemaMethod,
    schemaGet(interp, z, key) {
      const v = schemaGet(interp, z, key);
      if (v && v.k === 'nf') v.schema = z;
      return v;
    },
    evMethod: evMethodHook,
    ...roleHooks,
    onTyped,
    classFields: (interp, c) => classValueFields(interp, c),
    unknownCall(interp, callee, key, args, node, o, objKey) {
      if (o && objKey) {
        ormStaticInit(o, objKey, args);
        ormObjectCall(interp, o, objKey, args, false);
      }
      return bodyWithSchema(interp, args);
    },
    objectCall(interp, o, args, isNew) {
      if (isNew) ormObjectCall(interp, o, null, args, true);
      return undefined;
    },
    validateCall,
  };
}

export { unknown, str };
