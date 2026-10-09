// Call-style frameworks: how routers/apps are created, how routes and mounts are registered.
//
// A router value records entries in registration order:
//   { t: 'route', methods, path, handlers, opts, node, where }
//   { t: 'use',   path, mws }            middleware for the routes registered after it
//   { t: 'hook',  mws }                  middleware for every route of the router (Fastify hooks)
//   { t: 'guard', hook }                 Elysia guard/local hook object
//   { t: 'mount', path, target, mws }    a sub-router
//   { t: 'raw',   handler }              a fetch / node:http handler that routes by itself
//   { t: 'ws',    path }
import fs from 'node:fs';
import path from 'node:path';
import { U, UNDEF, unknown, str, num, obj, arr, native, newId, pkgPath, jsValue, isStr } from '../analyze/values.js';
import { SOURCE_EXTS } from '../analyze/resolve.js';

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all', 'trace', 'search', 'connect'];
const EXPRESS_LIKE = new Set(['express', 'polka', 'tinyhttp', 'restify', 'hyper-express', 'ultimate-express', 'itty', 'connect',
  'h3', 'next-connect', 'feathers', 'nextconnect', 'restify-router', 'expressots']);

export function makeRouter(interp, fw, node, extra = {}) {
  const r = { k: 'r', fw, id: newId(), entries: [], prefix: '', props: new Map(), decorations: new Map(), parent: null, where: interp.where(node), ...extra };
  interp.routers.push(r);
  return r;
}

function pathList(v) {
  if (!v) return null;
  if (v.k === 's') return [v];
  if (v.k === 'a') return v.items.filter((x) => x.k === 's' || x.k === 're');
  if (v.k === 're') return [v];
  return null;
}

function flat(values) {
  const out = [];
  for (const v of values) {
    if (v && v.k === 'a') out.push(...flat(v.items));
    else if (v) out.push(v);
  }
  return out;
}

function isRouter(v) {
  return v && v.k === 'r' && !v.chainOf && !v.routeRef;
}

function addRoute(interp, r, methods, pathVal, handlers, opts, node, extra) {
  const target = r.chainOf || r;
  const where = interp.where(node);
  const paths = pathVal === null ? [str('')] : pathList(pathVal);
  const entries = [];
  if (!paths || !paths.length) {
    interp.warn(`${where}: route path could not be resolved statically; skipped`);
    return entries;
  }
  for (const p of paths) {
    const e = {
      t: 'route', methods: methods.map((m) => m.toUpperCase()), path: p.k === 's' ? p.v : null, regex: p.k === 're' ? p.source : null,
      partial: !!p.partial, handlers: flat(handlers), opts: opts || null, node, where, meta: { ...(extra || {}) },
    };
    target.entries.push(e);
    entries.push(e);
  }
  return entries;
}

function recordPort(interp, v) {
  if (!v) return;
  if (v.k === 'n') interp.ports.push(v.v);
  else if (v.k === 's' && /^\d+$/.test(v.v)) interp.ports.push(Number(v.v));
  else if (v.k === 'o') recordPort(interp, v.props.get('port'));
}

function unwrapModule(interp, v) {
  if (!v) return v;
  if (v.k === 'o' && v.nsRec) return interp.getExport(v.nsRec, 'default');
  if (v.k === 'o' && v.proxyOf) return v.proxyOf;
  if (v.k === 'o' && v.props.has('default') && v.props.size <= 2) return v.props.get('default');
  return v;
}

function mount(interp, r, pathVal, target, mws, node) {
  const host = r.chainOf || r;
  const paths = pathVal ? pathList(pathVal) : [str('')];
  for (const p of paths || [str('')]) {
    host.entries.push({ t: 'mount', path: p.k === 's' ? p.v : '', target, mws: mws || [], where: interp.where(node) });
  }
  if (!target.parent) target.parent = host;
}

// --- Express and compatible (polka, tinyhttp, restify, hyper-express, ultimate-express, itty-router, h3 router) ---

function expressUse(interp, r, args, node) {
  let i = 0;
  let pathVal = null;
  if (args[0] && (args[0].k === 's' || args[0].k === 're' || (args[0].k === 'a' && args[0].items.length && args[0].items.every((x) => x.k === 's')))) {
    pathVal = args[0];
    i = 1;
  }
  const items = flat(args.slice(i));
  const mws = [];
  let mounted = false;
  for (const raw of items) {
    const item = unwrapModule(interp, raw);
    if (isRouter(item)) {
      mount(interp, r, pathVal, item, [...mws], node);
      mounted = true;
    } else if (item && item.k === 'o' && item.mountWrap) {
      mount(interp, r, str(item.mountWrap.path), item.mountWrap.target, [...mws], node);
      mounted = true;
    } else if (r.fw === 'feathers' && pathVal && item && (item.k === 'o' || item.k === 'p')) {
      feathersService(interp, r, pathVal, item, mws, node);
      mounted = true;
    } else if (item && item.k === 'f' && item.isFetch && item.fetchOf) {
      mount(interp, r, pathVal, item.fetchOf, [...mws], node);
      mounted = true;
    } else {
      mws.push(item);
    }
  }
  if (mws.length && !mounted) r.entries.push({ t: 'use', path: pathVal && pathVal.k === 's' ? pathVal.v : null, mws, where: interp.where(node) });
}

function expressMethod(interp, r, key, args, node) {
  if (r.chainOf) {
    if (HTTP_METHODS.includes(key) || key === 'del') {
      addRoute(interp, r, [key === 'del' ? 'delete' : key], str(r.chainPath), args, null, node);
      return r;
    }
    return undefined;
  }
  if (HTTP_METHODS.includes(key) || key === 'del') {
    const method = key === 'del' ? 'delete' : key;
    if (r.fw === 'express' && key === 'get' && args.length === 1 && args[0].k === 's' && r.isApp) return U; // app.get('setting')
    let pathVal = args[0];
    let handlers = args.slice(1);
    if (pathVal && pathVal.k === 'o' && r.fw === 'restify') {
      pathVal = pathVal.props.get('path') || pathVal.props.get('url');
    } else if (!pathVal || (pathVal.k !== 's' && pathVal.k !== 'a' && pathVal.k !== 're')) {
      if (r.fw === 'next-connect' || r.fw === 'nextconnect' || r.fw === 'h3') {
        pathVal = str('');
        handlers = args;
      }
    }
    addRoute(interp, r, [method], pathVal, handlers, null, node);
    return r;
  }
  switch (key) {
    case 'route': {
      const p = args[0];
      return makeChain(r, p && p.k === 's' ? p.v : '');
    }
    case 'use':
    case 'pre':
      if (r.fw === 'h3' && args[0] && args[0].k === 's' && args.length >= 2 && !args.slice(1).some((a) => isRouter(a))) {
        // h3 v1 router.use(path, handler) = any method
        addRoute(interp, r, ['all'], args[0], args.slice(1), null, node);
        return r;
      }
      expressUse(interp, r, args, node);
      return r;
    case 'listen':
      recordPort(interp, args[0]);
      interp.callbacks(args.filter((a) => a.k === 'f'), node);
      return unknown('server');
    case 'ws':
      if (args[0] && args[0].k === 's') interp.websockets.push({ path: args[0].v, where: interp.where(node), router: r });
      return r;
    case 'applyRoutes': // restify-router: router.applyRoutes(server, prefix)
      if (isRouter(args[0])) mount(interp, args[0], args[1] && args[1].k === 's' ? args[1] : str(''), r, [], node);
      return U;
    case 'add': // restify-router: router.add(prefix, otherRouter)
      if (args[0] && isRouter(args[1])) mount(interp, r, args[0], args[1], [], node);
      return r;
    case 'mount': // h3 v2: app.mount(base, otherApp)
      if (args[0] && isRouter(unwrapModule(interp, args[1]))) mount(interp, r, args[0], unwrapModule(interp, args[1]), [], node);
      return r;
    case 'handler': case 'handle': case 'run': case 'nodeHandler': // next-connect: export default router.handler()
      return r;
    case 'set': case 'enable': case 'disable': case 'engine': case 'param': case 'disable_x_powered_by':
      return r;
    case 'configure': // feathers: app.configure(fn)
      for (const a of args) if (a.k === 'f') interp.callFunction(a, [r], r, node);
      return r;
    case 'service': return U;
    default: return undefined;
  }
}

function makeChain(r, p) {
  return { k: 'r', fw: r.fw, chainOf: r, chainPath: p, entries: [], props: new Map(), decorations: new Map() };
}

// --- Feathers services -----------------------------------------------------------------------

const FEATHERS = [['find', 'GET', false], ['get', 'GET', true], ['create', 'POST', false], ['update', 'PUT', true], ['patch', 'PATCH', true], ['remove', 'DELETE', true]];

function feathersService(interp, r, pathVal, service, mws, node) {
  const base = pathVal.v.replace(/\/+$/, '');
  for (const [name, method, withId] of FEATHERS) {
    let handler = null;
    if (service.k === 'o') {
      handler = interp.getMember(service, name);
      if (!handler || (handler.k !== 'f' && handler.k !== 'nf')) continue;
    }
    addRoute(interp, r, [method], str(withId ? `${base}/:id` : base), [...mws, handler || U], null, node, { feathers: name });
  }
}

// --- Koa / koa-router / @koa/router / Oak ----------------------------------------------------

function koaRouterMethod(interp, r, key, args, node) {
  if (HTTP_METHODS.includes(key) || key === 'del') {
    const method = key === 'del' ? 'delete' : key;
    let i = 0;
    if (args[0] && args[0].k === 's' && args[1] && (args[1].k === 's' || args[1].k === 'a' || args[1].k === 're')) i = 1; // named route
    const pathVal = args[i] && (args[i].k === 's' || args[i].k === 'a' || args[i].k === 're') ? args[i] : null;
    addRoute(interp, r, [method], pathVal === null ? str('') : pathVal, args.slice(pathVal ? i + 1 : i), null, node);
    return r;
  }
  switch (key) {
    case 'use': {
      let i = 0;
      let pathVal = null;
      if (args[0] && (args[0].k === 's' || args[0].k === 'a')) { pathVal = args[0]; i = 1; }
      const mws = [];
      for (const raw of flat(args.slice(i))) {
        const item = unwrapModule(interp, raw);
        if (isRouter(item)) mount(interp, r, pathVal, item, [...mws], node);
        else mws.push(item);
      }
      if (mws.length) r.entries.push({ t: 'use', path: pathVal && pathVal.k === 's' ? pathVal.v : null, mws, where: interp.where(node) });
      return r;
    }
    case 'prefix':
      if (args[0] && args[0].k === 's') r.prefix = args[0].v;
      return r;
    case 'routes': case 'middleware':
      return r;
    case 'allowedMethods':
      return U;
    case 'register': {
      const methods = args[1] && args[1].k === 'a' ? args[1].items.filter((x) => x.k === 's').map((x) => x.v.toLowerCase()) : ['get'];
      addRoute(interp, r, methods, args[0], [args[2]].filter(Boolean), null, node);
      return r;
    }
    default:
      return undefined;
  }
}

function koaAppMethod(interp, r, key, args, node) {
  switch (key) {
    case 'use': {
      for (const raw of flat(args)) {
        const item = unwrapModule(interp, raw);
        if (isRouter(item)) mount(interp, r, null, item, [], node);
        else if (item && item.k === 'o' && item.mountWrap) mount(interp, r, str(item.mountWrap.path), item.mountWrap.target, [], node);
        else r.entries.push({ t: 'use', path: null, mws: [item], where: interp.where(node) });
      }
      return r;
    }
    case 'listen':
      recordPort(interp, args[0]);
      return unknown('server');
    case 'callback': case 'handle': case 'fetch':
      return U;
    default:
      return undefined;
  }
}

// --- Fastify ---------------------------------------------------------------------------------

const FASTIFY_HOOKS = new Set(['onRequest', 'preHandler', 'preValidation', 'preParsing']);

function fastifyRoute(interp, r, methods, pathVal, opts, handler, node) {
  const o = opts && opts.k === 'o' ? opts : null;
  const h = handler || (o && o.props.get('handler'));
  if (o && o.props.get('websocket') && o.props.get('websocket').k === 'b' && o.props.get('websocket').v) {
    if (pathVal && pathVal.k === 's') interp.websockets.push({ path: pathVal.v, where: interp.where(node), router: r });
    return;
  }
  addRoute(interp, r, methods, pathVal, h ? [h] : [], o, node);
}

function fastifyRegister(interp, r, args, node) {
  let plugin = unwrapModule(interp, args[0]);
  const opts = args[1] && args[1].k === 'o' ? args[1] : null;
  const prefixVal = opts && opts.props.get('prefix');
  const prefix = prefixVal && prefixVal.k === 's' ? prefixVal.v : '';
  if (plugin && plugin.k === 'p') {
    const name = plugin.pkg;
    if (name === '@fastify/autoload' || name === 'fastify-autoload') {
      fastifyAutoload(interp, r, opts, node);
      return r;
    }
    if (name === '@fastify/jwt' || name === 'fastify-jwt') interp.state.authPlugins.add('bearer');
    else if (name === '@fastify/basic-auth') interp.state.authPlugins.add('basic');
    else if (name === '@fastify/session' || name === '@fastify/secure-session' || name === '@fastify/passport') interp.state.authPlugins.add('session');
    return r;
  }
  if (plugin && plugin.k === 'o' && plugin.props.has('plugin')) plugin = plugin.props.get('plugin');
  if (!plugin || (plugin.k !== 'f' && plugin.k !== 'nf')) return r;
  if (plugin.fp) {
    interp.callValue(plugin, [r, opts || obj(), U], UNDEF, node);
    return r;
  }
  const child = makeRouter(interp, 'fastify', node, { parent: r });
  r.entries.push({ t: 'mount', path: prefix, target: child, mws: [], where: interp.where(node) });
  interp.callValue(plugin, [child, opts || obj(), native('done', () => UNDEF)], UNDEF, node);
  return r;
}

function fastifyAutoload(interp, r, opts, node) {
  if (!opts) return;
  const dirVal = opts.props.get('dir');
  if (!dirVal || dirVal.k !== 's') {
    interp.warn(`${interp.where(node)}: @fastify/autoload dir could not be resolved`);
    return;
  }
  const inner = opts.props.get('options');
  const basePrefix = inner && inner.k === 'o' && inner.props.get('prefix') && inner.props.get('prefix').k === 's' ? inner.props.get('prefix').v : '';
  const routeParams = opts.props.get('routeParams');
  const dirPrefix = opts.props.get('dirNameRoutePrefix');
  const useDirPrefix = !(dirPrefix && dirPrefix.k === 'b' && dirPrefix.v === false);
  const ignore = opts.props.get('ignorePattern');
  const ignoreRe = ignore && ignore.k === 're' ? safeRegex(ignore.source, ignore.flags) : null;
  const walk = (dir, prefix, depth) => {
    if (depth > 8) return;
    let names;
    try {
      names = fs.readdirSync(dir).sort();
    } catch {
      return;
    }
    const files = names.filter((n) => SOURCE_EXTS.includes(path.extname(n)) && !/\.d\.[cm]?ts$/.test(n) && !/\.(test|spec)\./.test(n)
      && !n.startsWith('.') && !(ignoreRe && ignoreRe.test(n)) && !/^autohooks\./.test(n));
    const index = files.find((n) => /^index\.[cm]?[jt]s$/.test(n));
    const load = index ? [index] : files;
    for (const f of load) {
      const rec = interp.loadModule(path.join(dir, f));
      let plugin = rec.esm ? interp.getExport(rec, 'default') : interp.cjsExports(rec);
      let p = prefix;
      const auto = rec.esm ? interp.getExport(rec, 'autoPrefix') : interp.getMember(interp.cjsExports(rec), 'autoPrefix');
      if (auto && auto.k === 's') p = joinUrl(prefix, auto.v);
      if (plugin && plugin.k === 'o' && plugin.props.has('default')) plugin = plugin.props.get('default');
      if (plugin && (plugin.k === 'f' || plugin.k === 'nf')) {
        fastifyRegister(interp, r, [plugin, obj([['prefix', str(joinUrl(basePrefix, p))]])], node);
      }
    }
    if (index) return;
    for (const n of names) {
      const full = path.join(dir, n);
      let isDir = false;
      try { isDir = fs.statSync(full).isDirectory(); } catch { /* ignore */ }
      if (!isDir || n.startsWith('.') || n === 'node_modules') continue;
      let seg = n;
      if (routeParams && routeParams.k === 'b' && routeParams.v && seg.startsWith('_')) seg = ':' + seg.slice(1);
      walk(full, useDirPrefix ? joinUrl(prefix, seg) : prefix, depth + 1);
    }
  };
  walk(dirVal.v, '', 0);
}

function safeRegex(source, flags) {
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

function joinUrl(a, b) {
  const s = `${a || ''}/${b || ''}`.replace(/\/{2,}/g, '/');
  return s === '/' ? '' : s.replace(/\/$/, '');
}

function fastifyMethod(interp, r, key, args, node) {
  if (HTTP_METHODS.includes(key)) {
    const pathVal = args[0];
    let opts = null;
    let handler = null;
    if (args.length >= 3) { opts = args[1]; handler = args[2]; } else if (args[1] && args[1].k === 'o' && !args[1].nsRec) opts = args[1]; else handler = args[1];
    fastifyRoute(interp, r, [key === 'all' ? 'all' : key], pathVal, opts, handler, node);
    return r;
  }
  switch (key) {
    case 'route': {
      const o = args[0];
      if (!o || o.k !== 'o') return r;
      const m = o.props.get('method');
      const methods = m && m.k === 'a' ? m.items.filter((x) => x.k === 's').map((x) => x.v) : m && m.k === 's' ? [m.v] : ['GET'];
      fastifyRoute(interp, r, methods, o.props.get('url') || o.props.get('path'), o, null, node);
      return r;
    }
    case 'register':
      return fastifyRegister(interp, r, args, node);
    case 'addHook': {
      const name = args[0] && args[0].k === 's' ? args[0].v : '';
      if (FASTIFY_HOOKS.has(name) && args[1]) r.entries.push({ t: 'hook', mws: [args[1]], where: interp.where(node) });
      return r;
    }
    case 'decorate':
      if (args[0] && args[0].k === 's') r.decorations.set(args[0].v, args[1] || U);
      return r;
    case 'listen':
      recordPort(interp, args[0]);
      return U;
    case 'withTypeProvider': case 'after': case 'setValidatorCompiler': case 'setSerializerCompiler': case 'setErrorHandler':
    case 'setNotFoundHandler': case 'addSchema': case 'addContentTypeParser': case 'decorateRequest': case 'decorateReply':
      if (key === 'after') interp.callbacks(args.filter((a) => a.k === 'f'), node);
      return r;
    case 'ready': case 'close': case 'inject': case 'printRoutes': case 'swagger':
      return U;
    default:
      return undefined;
  }
}

function fastifyGet(interp, r, key) {
  for (let x = r; x; x = x.parent) if (x.decorations.has(key)) return x.decorations.get(key);
  return undefined;
}

// --- Hono ------------------------------------------------------------------------------------

function honoMethod(interp, r, key, args, node) {
  if (HTTP_METHODS.includes(key) && key !== 'connect') {
    let pathVal = args[0];
    let handlers = args.slice(1);
    if (!pathVal || (pathVal.k !== 's' && pathVal.k !== 'a')) {
      pathVal = str(r.lastPath || '/');
      handlers = args;
    }
    r.lastPath = pathVal.k === 's' ? pathVal.v : r.lastPath;
    addRoute(interp, r, [key], pathVal, handlers, null, node);
    return r;
  }
  switch (key) {
    case 'on': {
      const m = args[0];
      const methods = m && m.k === 'a' ? m.items.filter((x) => x.k === 's').map((x) => x.v) : m && m.k === 's' ? [m.v] : ['get'];
      addRoute(interp, r, methods, args[1], args.slice(2), null, node);
      return r;
    }
    case 'use': {
      let pathVal = null;
      let mws = args;
      if (args[0] && args[0].k === 's') { pathVal = args[0].v; mws = args.slice(1); }
      r.entries.push({ t: 'use', path: pathVal, mws: flat(mws), where: interp.where(node) });
      return r;
    }
    case 'route': {
      const sub = unwrapModule(interp, args[1]);
      if (isRouter(sub)) mount(interp, r, args[0], sub, [], node);
      return r;
    }
    case 'basePath': {
      // the new instance shares the router; its routes include the base path wherever it is mounted
      const b = makeRouter(interp, 'hono', node);
      b.prefix = joinUrl(r.prefix || '', args[0] && args[0].k === 's' ? args[0].v : '');
      b.basePathOf = r;
      r.entries.push({ t: 'mount', path: '', target: b, mws: [], where: interp.where(node), shared: true });
      return b;
    }
    case 'openapi': {
      const def = args[0];
      if (def && def.k === 'o') {
        const m = def.props.get('method');
        const p = def.props.get('path');
        if (m && m.k === 's' && p && p.k === 's') addRoute(interp, r, [m.v], str(p.v.replace(/\{(\w+)\}/g, ':$1')), args.slice(1), def, node, { openapi: true });
      }
      return r;
    }
    case 'mount': case 'notFound': case 'onError': case 'doc': case 'doc31': case 'showRoutes':
      return r;
    case 'fire': case 'request':
      return U;
    default:
      return undefined;
  }
}

// --- Elysia ----------------------------------------------------------------------------------

function elysiaMethod(interp, r, key, args, node) {
  if (HTTP_METHODS.includes(key) && key !== 'connect') {
    addRoute(interp, r, [key], args[0], args[1] ? [args[1]] : [], args[2] || null, node);
    return r;
  }
  switch (key) {
    case 'route': {
      const m = args[0];
      const methods = m && m.k === 'a' ? m.items.filter((x) => x.k === 's').map((x) => x.v) : m && m.k === 's' ? [m.v] : ['get'];
      addRoute(interp, r, methods, args[1], args[2] ? [args[2]] : [], args[3] || null, node);
      return r;
    }
    case 'group': {
      const prefix = args[0];
      const hook = args.length >= 3 ? args[1] : null;
      const cb = args[args.length - 1];
      const child = makeRouter(interp, 'elysia', node, { models: r.models });
      if (hook && hook.k === 'o') child.entries.push({ t: 'guard', hook, where: interp.where(node) });
      mount(interp, r, prefix, child, [], node);
      if (cb && cb.k === 'f') {
        const res = interp.callFunction(cb, [child], UNDEF, node);
        if (isRouter(res) && res !== child) mount(interp, child, str(''), res, [], node);
      }
      return r;
    }
    case 'guard': {
      const hook = args[0];
      const cb = args[1];
      if (cb && cb.k === 'f') {
        const child = makeRouter(interp, 'elysia', node, { models: r.models });
        if (hook && hook.k === 'o') child.entries.push({ t: 'guard', hook, where: interp.where(node) });
        mount(interp, r, str(''), child, [], node);
        const res = interp.callFunction(cb, [child], UNDEF, node);
        if (isRouter(res) && res !== child) mount(interp, child, str(''), res, [], node);
      } else if (hook && hook.k === 'o') {
        r.entries.push({ t: 'guard', hook, where: interp.where(node) });
      }
      return r;
    }
    case 'use': {
      for (const raw of flat(args)) {
        const plugin = unwrapModule(interp, raw);
        if (isRouter(plugin)) {
          if (plugin !== r) mount(interp, r, str(''), plugin, [], node);
        } else if (plugin && plugin.k === 'f') {
          const res = interp.callFunction(plugin, [r], UNDEF, node);
          if (isRouter(res) && res !== r) mount(interp, r, str(''), res, [], node);
        } else if (plugin && plugin.k === 'p') {
          const name = plugin.pkg;
          if (name === '@elysiajs/jwt') interp.state.authPlugins.add('bearer');
          if (name === '@elysiajs/bearer') interp.state.authPlugins.add('bearer');
        }
      }
      return r;
    }
    case 'model': {
      r.models = r.models || new Map();
      if (args[0] && args[0].k === 'o') for (const [k, v] of args[0].props) r.models.set(k, v);
      else if (args[0] && args[0].k === 's') r.models.set(args[0].v, args[1]);
      return r;
    }
    case 'onBeforeHandle': case 'derive': case 'resolve': case 'onRequest': case 'onTransform': case 'beforeHandle': {
      const fnArg = args.find((a) => a.k === 'f');
      if (fnArg) r.entries.push({ t: 'use', path: null, mws: [fnArg], hookKind: key, where: interp.where(node) });
      return r;
    }
    case 'ws':
      if (args[0] && args[0].k === 's') interp.websockets.push({ path: args[0].v, where: interp.where(node), router: r });
      return r;
    case 'listen':
      recordPort(interp, args[0]);
      return r;
    case 'state': case 'decorate': case 'error': case 'onError': case 'onAfterHandle': case 'mapResponse': case 'onStart':
    case 'onStop': case 'macro': case 'headers': case 'trace': case 'mount': case 'compile': case 'as': case 'onParse':
    case 'onAfterResponse': case 'wrap':
      return r;
    case 'handle': case 'fetch':
      return U;
    default:
      return undefined;
  }
}

// --- Hapi ------------------------------------------------------------------------------------

function hapiRoute(interp, r, cfg, node) {
  if (!cfg || cfg.k !== 'o') return;
  const m = cfg.props.get('method');
  const methods = m && m.k === 'a' ? m.items.filter((x) => x.k === 's').map((x) => x.v) : m && m.k === 's' ? [m.v] : ['GET'];
  const options = cfg.props.get('options') || cfg.props.get('config');
  let handler = cfg.props.get('handler');
  if ((!handler || handler.k === 'u') && options && options.k === 'o') handler = options.props.get('handler');
  const p = cfg.props.get('path');
  if (!p || p.k !== 's') return;
  addRoute(interp, r, methods.map((x) => (x === '*' ? 'all' : x)), str(p.v.replace(/\{(\w+)(\*\d*|\?)?\}/g, ':$1')), handler ? [handler] : [], options && options.k === 'o' ? options : null, node, { hapi: true });
}

function hapiRegister(interp, r, args, node) {
  const list = args[0] && args[0].k === 'a' ? args[0].items : [args[0]];
  const opts = args[1] && args[1].k === 'o' ? args[1] : null;
  const prefixOf = (o) => {
    const routes = o && o.k === 'o' ? o.props.get('routes') : null;
    const p = routes && routes.k === 'o' ? routes.props.get('prefix') : null;
    return p && p.k === 's' ? p.v : '';
  };
  for (const raw of list) {
    let item = unwrapModule(interp, raw);
    if (!item) continue;
    let prefix = prefixOf(opts);
    let options = obj();
    if (item.k === 'o' && item.props.has('plugin')) {
      prefix = prefixOf(item) || prefix;
      if (item.props.get('options')) options = item.props.get('options');
      item = unwrapModule(interp, item.props.get('plugin'));
      if (item && item.k === 'o' && item.props.has('plugin') && !item.props.has('register')) item = item.props.get('plugin');
    }
    if (item && item.k === 'p') {
      const name = item.pkg;
      if (/hapi-auth-jwt2|@hapi\/jwt/.test(name)) interp.state.authPlugins.add('bearer');
      else if (name === '@hapi/basic' || name === 'hapi-auth-basic') interp.state.authPlugins.add('basic');
      else if (name === '@hapi/cookie' || name === 'hapi-auth-cookie') interp.state.authPlugins.add('session');
      continue;
    }
    const register = item && item.k === 'o' ? item.props.get('register') : null;
    if (register && (register.k === 'f' || register.k === 'nf')) {
      const child = makeRouter(interp, 'hapi', node, { parent: r });
      r.entries.push({ t: 'mount', path: prefix, target: child, mws: [], where: interp.where(node) });
      interp.callValue(register, [child, options], item, node);
    }
  }
  return U;
}

function hapiAuth(interp, r) {
  const root = rootOf(r);
  return obj([
    ['strategy', native('strategy', (args) => {
      const name = args[0] && args[0].k === 's' ? args[0].v : '';
      const scheme = args[1] && args[1].k === 's' ? args[1].v : '';
      if (name) interp.state.hapiStrategies.set(name, scheme);
      return U;
    })],
    ['default', native('default', (args) => {
      const a = args[0];
      if (a && a.k === 's') root.defaultAuth = a.v;
      else if (a && a.k === 'o') { const s = a.props.get('strategy') || a.props.get('strategies'); root.defaultAuth = s && s.k === 's' ? s.v : 'default'; }
      return U;
    })],
    ['scheme', native('scheme', () => U)],
  ]);
}

function rootOf(r) {
  let x = r;
  while (x.parent) x = x.parent;
  return x;
}

function hapiMethod(interp, r, key, args, node) {
  switch (key) {
    case 'route':
      for (const cfg of flat(args)) hapiRoute(interp, r, cfg, node);
      return U;
    case 'register':
      return hapiRegister(interp, r, args, node);
    case 'start': case 'initialize': case 'ext': case 'method': case 'bind': case 'state': case 'decorate': case 'validator':
    case 'inject': case 'table': case 'dependency': case 'expose': case 'views': case 'events': case 'stop':
      return U;
    default:
      return undefined;
  }
}

// --- AdonisJS --------------------------------------------------------------------------------

function adonisTarget(r) {
  const stack = r.groupStack || [];
  return stack.length ? stack[stack.length - 1] : r;
}

function adonisRouteRef(entries) {
  return { k: 'r', fw: 'adonis', routeRef: entries, entries: [], props: new Map(), decorations: new Map() };
}

function adonisMethod(interp, r, key, args, node) {
  if (r.routeRef) {
    // route.use(...), .middleware(...), .as(...), .prefix(...)
    if (key === 'use' || key === 'middleware') {
      for (const e of r.routeRef) e.handlers.unshift(...flat(args));
      return r;
    }
    if (key === 'prefix') {
      for (const e of r.routeRef) if (args[0] && args[0].k === 's' && e.path != null) e.path = joinUrl(args[0].v, e.path) || '/';
      return r;
    }
    if (key === 'apiOnly' || key === 'only' || key === 'except') {
      const keep = key === 'apiOnly' ? (a) => a !== 'create' && a !== 'edit'
        : (a) => { const list = args[0] && args[0].k === 'a' ? args[0].items.map((x) => x.v) : []; return key === 'only' ? list.includes(a) : !list.includes(a); };
      for (const e of r.routeRef) if (e.meta.action && !keep(e.meta.action)) e.removed = true;
      return r;
    }
    if (key === 'params' || key === 'as' || key === 'where' || key === 'domain' || key === 'matchers' || key === 'name') return r;
    return r;
  }
  if (r.isGroup) {
    if (key === 'prefix') {
      if (args[0] && args[0].k === 's') r.prefix = joinUrl(args[0].v, r.prefix);
      return r;
    }
    if (key === 'use' || key === 'middleware') {
      r.entries.unshift({ t: 'use', path: null, mws: flat(args), where: interp.where(node) });
      return r;
    }
    if (key === 'as' || key === 'domain') return r;
  }
  const verbs = { get: ['get'], post: ['post'], put: ['put'], patch: ['patch'], delete: ['delete'], any: ['all'], route: null };
  if (verbs[key] !== undefined) {
    let methods = verbs[key];
    let a = args;
    if (key === 'route') {
      methods = args[1] && args[1].k === 'a' ? args[1].items.filter((x) => x.k === 's').map((x) => x.v) : ['get'];
      a = [args[0], args[2]];
    }
    const entries = addRoute(interp, adonisTarget(r), methods, a[0], [adonisHandler(interp, a[1])], null, node);
    return adonisRouteRef(entries);
  }
  switch (key) {
    case 'group': {
      const g = makeRouter(interp, 'adonis', node, { isGroup: true });
      const target = adonisTarget(r);
      target.entries.push({ t: 'mount', path: '', target: g, mws: [], where: interp.where(node) });
      r.groupStack = r.groupStack || [];
      r.groupStack.push(g);
      const cb = args[0];
      if (cb && cb.k === 'f') interp.callFunction(cb, [], UNDEF, node);
      r.groupStack.pop();
      return g;
    }
    case 'resource': case 'shallowResource': {
      const name = args[0] && args[0].k === 's' ? args[0].v : '';
      const ctl = args[1];
      const parts = name.split('.');
      let base = '';
      parts.forEach((p, i) => {
        base += `/${p}`;
        if (i < parts.length - 1) base += `/:${singularize(p)}_id`;
      });
      const actions = [['index', 'get', ''], ['create', 'get', '/create'], ['store', 'post', ''], ['show', 'get', '/:id'],
        ['edit', 'get', '/:id/edit'], ['update', 'put', '/:id'], ['update', 'patch', '/:id'], ['destroy', 'delete', '/:id']];
      const entries = [];
      for (const [action, method, suffix] of actions) {
        entries.push(...addRoute(interp, adonisTarget(r), [method], str(base + suffix), [adonisHandler(interp, arr([ctl, str(action)]))], null, node, { action }));
      }
      return adonisRouteRef(entries);
    }
    case 'named': {
      const out = obj();
      if (args[0] && args[0].k === 'o') for (const k of args[0].props.keys()) out.props.set(k, native(k, () => unknown('middleware.' + k)));
      return out;
    }
    case 'on': return adonisRouteRef([]);
    case 'use': return r;
    default: return undefined;
  }
}

function singularize(w) {
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

/** [Controller, 'method'] / lazy import / 'Controller.method' -> handler function value. */
function adonisHandler(interp, h) {
  if (!h) return U;
  if (h.k === 'a' && h.items.length) {
    let ctl = h.items[0];
    const method = h.items[1] && h.items[1].k === 's' ? h.items[1].v : 'handle';
    if (ctl.k === 'f' && ctl.node.params.length === 0) ctl = unwrapModule(interp, interp.callFunction(ctl, [], UNDEF, null));
    ctl = unwrapModule(interp, ctl);
    if (ctl && ctl.k === 'c') {
      const inst = interp.construct(ctl, [], null);
      const m = interp.getMember(inst, method);
      if (m && m.k === 'f') { m.ctlName = ctl.name; return m; }
    }
    return U;
  }
  if (h.k === 's' && h.v.includes('.')) {
    const [ctlName, method] = h.v.split(/[.@]/);
    const file = interp.resolver.probe(path.join(interp.root, 'app/Controllers/Http', ctlName)) || interp.resolver.probe(path.join(interp.root, 'app/controllers', ctlName));
    if (file) {
      const rec = interp.loadModule(file);
      const c = rec.esm ? interp.getExport(rec, 'default') : interp.cjsExports(rec);
      if (c && c.k === 'c') {
        const m = interp.getMember(interp.construct(c, [], null), method);
        if (m && m.k === 'f') return m;
      }
    }
    return U;
  }
  return h;
}

// --- package calls that create routers / wrap things -------------------------------------------

function optsProp(v, key) {
  return v && v.k === 'o' ? v.props.get(key) : undefined;
}

function fromPkg(interp, p, args, isNew, node) {
  const name = p.pkg;
  const sig = pkgPath(p).replace(/^default\./, '');
  const routerWithPrefix = (fw, extra = {}) => {
    const r = makeRouter(interp, fw, node, extra);
    const prefix = optsProp(args[0], 'prefix') || optsProp(args[0], 'base');
    if (prefix && prefix.k === 's') r.prefix = prefix.v;
    return r;
  };
  switch (name) {
    case 'express': case 'ultimate-express':
      if (sig === '()') return makeRouter(interp, 'express', node, { isApp: true });
      if (sig === 'Router()' || sig === 'express.Router()') return makeRouter(interp, 'express', node);
      if (/^(json|urlencoded|static|raw|text)\(\)$/.test(sig)) return unknown('express.' + sig);
      return undefined;
    case 'express-promise-router': case 'express-async-router': case 'router':
      if (sig === '()' || sig === 'Router()' || sig === 'AsyncRouter()') return makeRouter(interp, 'express', node);
      return undefined;
    case 'polka':
      if (sig === '()') return makeRouter(interp, 'polka', node, { isApp: true });
      return undefined;
    case '@tinyhttp/app': case '@tinyhttp/router':
      if (sig === 'App()' || sig === 'Router()') return makeRouter(interp, 'tinyhttp', node, { isApp: sig === 'App()' });
      return undefined;
    case 'restify':
      if (sig === 'createServer()') return makeRouter(interp, 'restify', node, { isApp: true });
      return undefined;
    case 'restify-router':
      if (sig === 'Router()' || sig === '()') return makeRouter(interp, 'restify-router', node);
      return undefined;
    case 'hyper-express':
      if (sig === 'Server()' || sig === 'Router()') return makeRouter(interp, 'hyper-express', node, { isApp: sig === 'Server()' });
      return undefined;
    case 'connect':
      if (sig === '()') return makeRouter(interp, 'connect', node, { isApp: true });
      return undefined;
    case 'itty-router':
      if (/^(Router|AutoRouter|IttyRouter)\(\)$/.test(sig)) return routerWithPrefix('itty');
      if (/^(json|error|withParams|withContent|cors|text|html|status)\(\)$/.test(sig)) return unknown(sig);
      return undefined;
    case 'next-connect':
      if (sig === 'createRouter()' || sig === '()' || sig === 'createEdgeRouter()') return makeRouter(interp, 'next-connect', node);
      return undefined;
    case 'koa':
      if (sig === '()') return makeRouter(interp, 'koa', node, { isApp: true });
      return undefined;
    case '@koa/router': case 'koa-router': case 'koa-tree-router': case '@koa/router/lib/router':
      if (sig === '()' || sig === 'Router()') return routerWithPrefix('koa-router');
      return undefined;
    case 'koa-mount': {
      if (sig === '()') {
        const [a, b] = args;
        const target = unwrapModule(interp, b);
        if (a && a.k === 's' && isRouter(target)) return obj([], { mountWrap: { path: a.v, target } });
        if (isRouter(unwrapModule(interp, a))) return obj([], { mountWrap: { path: '', target: unwrapModule(interp, a) } });
      }
      return undefined;
    }
    case 'oak': case '@oak/oak': case '@oakserver/oak':
      if (sig === 'Router()') return routerWithPrefix('oak-router');
      if (sig === 'Application()') return makeRouter(interp, 'oak', node, { isApp: true });
      return undefined;
    case 'fastify':
      if (sig === '()' || sig === 'fastify()' || sig === 'Fastify()') return makeRouter(interp, 'fastify', node, { isApp: true });
      return undefined;
    case 'fastify-plugin':
      if (sig === '()' || sig === 'fp()' || sig === 'default()') {
        const f = args[0];
        if (f && (f.k === 'f' || f.k === 'nf')) return { ...f, fp: true };
      }
      return undefined;
    case 'hono': case 'hono/tiny': case 'hono/quick':
      if (sig === 'Hono()') return routerWithPrefix('hono');
      return undefined;
    case '@hono/zod-openapi': case '@hono/openapi':
      if (sig === 'OpenAPIHono()') return makeRouter(interp, 'hono', node);
      if (sig === 'createRoute()') return args[0];
      return undefined;
    case 'hono/factory':
      if (sig === 'createFactory()') return obj([
        ['createApp', native('createApp', () => makeRouter(interp, 'hono', node))],
        ['createHandlers', native('createHandlers', (a) => arr(a))],
        ['createMiddleware', native('createMiddleware', (a) => a[0] || U)],
      ]);
      if (sig === 'createMiddleware()') return args[0] || U;
      return undefined;
    case 'elysia':
      if (sig === 'Elysia()') return routerWithPrefix('elysia', { models: new Map() });
      return undefined;
    case '@hapi/hapi': case 'hapi': {
      if (sig === 'server()' || sig === 'Server()') {
        recordPort(interp, args[0]);
        return makeRouter(interp, 'hapi', node, { isApp: true });
      }
      return undefined;
    }
    case 'h3':
      if (sig === 'createApp()' || sig === 'H3()' || sig === 'createH3()') return makeRouter(interp, 'h3', node, { isApp: true });
      if (sig === 'createRouter()') return makeRouter(interp, 'h3', node);
      if (/^(defineEventHandler|eventHandler|defineHandler|defineCachedEventHandler|lazyEventHandler)\(\)$/.test(sig)) {
        const a = args[0];
        if (a && a.k === 'o') return a.props.get('handler') || U;
        return a || U;
      }
      if (sig === 'useBase()') {
        const target = args[1] && args[1].k === 'r' ? args[1] : null;
        if (target && args[0] && args[0].k === 's') return obj([], { mountWrap: { path: args[0].v, target } });
      }
      return undefined;
    case '@feathersjs/feathers': case '@feathersjs/express': case '@feathersjs/koa':
      if (sig === '()' || sig === 'feathers()' || sig === 'default()') {
        const a = args[0];
        if (isRouter(a)) { a.fw = 'feathers'; return a; }
        return makeRouter(interp, 'feathers', node, { isApp: true });
      }
      return undefined;
    case 'socket.io':
      if (sig === 'Server()' || sig === '()') {
        const o = args.find((a) => a.k === 'o');
        const pth = optsProp(o, 'path');
        interp.websockets.push({ path: pth && pth.k === 's' ? pth.v : '/socket.io/', where: interp.where(node), description: 'Socket.IO' });
      }
      return undefined;
    case 'ws':
      if (sig === 'WebSocketServer()' || sig === 'Server()') {
        const pth = optsProp(args[0], 'path');
        interp.websockets.push({ path: pth && pth.k === 's' ? pth.v : '/', where: interp.where(node), description: 'WebSocket' });
      }
      return undefined;
    case 'express-ws':
      return U;
    case '@hono/node-server':
      if (sig === 'serve()') {
        recordPort(interp, args[0]);
        return U;
      }
      return undefined;
    case 'http': case 'https': case 'http2': {
      if (sig === 'createServer()' || sig === 'createSecureServer()') {
        const h = args.find((a) => a.k === 'f' || a.k === 'r');
        if (h && h.k === 'f') {
          const r = makeRouter(interp, 'node', node, { isApp: true });
          r.entries.push({ t: 'raw', handler: h, fw: 'node', where: interp.where(node) });
          return serverValue(interp, r);
        }
        return serverValue(interp, h || null);
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

function serverValue(interp, r) {
  return obj([
    ['listen', native('listen', (args) => { recordPort(interp, args[0]); return U; })],
    ['on', native('on', () => U)],
  ], { serverOf: r });
}

/** Bun.serve({ routes, fetch, port }) and Deno.serve(...). */
export function bunServe(interp, args, node) {
  const o = args[0];
  const r = makeRouter(interp, 'bun', node, { isApp: true });
  if (!o || o.k !== 'o') return U;
  recordPort(interp, o);
  const routes = o.props.get('routes') || o.props.get('static');
  if (routes && routes.k === 'o') {
    for (const [p, v] of routes.props) {
      if (v.k === 'o' && !v.nsRec) {
        for (const [m, h] of v.props) if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(m)) addRoute(interp, r, [m], str(p), [h], null, node);
      } else if (v.k === 'f') {
        addRoute(interp, r, ['all'], str(p), [v], null, node, { bunAll: true });
      } else {
        addRoute(interp, r, ['get'], str(p), [], null, node);
      }
    }
  }
  const fetch = o.props.get('fetch');
  if (fetch && fetch.k === 'f') r.entries.push({ t: 'raw', handler: fetch, fw: 'bun', where: interp.where(node) });
  else if (fetch && fetch.k === 'r') mount(interp, r, str(''), fetch, [], node);
  if (o.props.get('websocket')) interp.websockets.push({ path: '/', where: interp.where(node), description: 'Bun WebSocket' });
  return U;
}

export function denoServe(interp, args, node) {
  const h = args.find((a) => a.k === 'f');
  const opts = args.find((a) => a.k === 'o');
  if (opts) {
    recordPort(interp, opts);
    const handler = opts.props.get('handler');
    if (handler && handler.k === 'f' && !h) return denoServe(interp, [handler], node);
  }
  if (h) {
    const r = makeRouter(interp, 'deno', node, { isApp: true });
    r.entries.push({ t: 'raw', handler: h, fw: 'deno', where: interp.where(node) });
  }
  return U;
}

// --- dispatch --------------------------------------------------------------------------------

export function routerMethod(interp, r, key, args, node) {
  if (interp.analyzing) {
    // While analysing handlers, router calls must not register new routes.
    if (HTTP_METHODS.includes(key) || ['use', 'route', 'register', 'group', 'mount'].includes(key)) return r;
  }
  if (r.fw === 'adonis') return adonisMethod(interp, r, key, args, node);
  if (r.fw === 'fastify') return fastifyMethod(interp, r, key, args, node);
  if (r.fw === 'hono') return honoMethod(interp, r, key, args, node);
  if (r.fw === 'elysia') return elysiaMethod(interp, r, key, args, node);
  if (r.fw === 'hapi') return hapiMethod(interp, r, key, args, node);
  if (r.fw === 'koa' || r.fw === 'oak') {
    const v = koaAppMethod(interp, r, key, args, node);
    if (v !== undefined) return v;
    return undefined;
  }
  if (r.fw === 'koa-router' || r.fw === 'oak-router') return koaRouterMethod(interp, r, key, args, node);
  if (EXPRESS_LIKE.has(r.fw)) return expressMethod(interp, r, key, args, node);
  if (key === 'listen') { recordPort(interp, args[0]); return U; }
  return undefined;
}

export function routerGet(interp, r, key) {
  if (r.fw === 'fastify') {
    const v = fastifyGet(interp, r, key);
    if (v) return v;
    if (key === 'prefix') return str(r.prefix || '');
  }
  if (r.fw === 'hapi' && key === 'auth') return hapiAuth(interp, r);
  if (r.fw === 'hapi' && (key === 'info' || key === 'settings' || key === 'plugins' || key === 'app' || key === 'realm')) return unknown('server.' + key);
  if (key === 'fetch' || key === 'handler' || key === 'handle' || key === 'callback') {
    // app.fetch passed to serve()/Bun.serve()/export default { fetch }
    return { k: 'f', node: null, name: 'fetch', isFetch: true, fetchOf: r, id: newId() };
  }
  if (r.decorations && r.decorations.has(key)) return r.decorations.get(key);
  if (r.props && r.props.has(key)) return r.props.get(key);
  if (HTTP_METHODS.includes(key) || ['use', 'route', 'register', 'group', 'listen'].includes(key)) {
    // a method read without calling it (e.g. passed around): bind it
    return native(key, (args, _t, node) => interp.callMethod(r, key, args, node));
  }
  return undefined;
}

export function routerPkgCall(interp, p, args, isNew, node) {
  return fromPkg(interp, p, args, isNew, node);
}

export { isRouter, unwrapModule, joinUrl, recordPort, isStr, jsValue };
