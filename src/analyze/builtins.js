// JavaScript globals and Node built-ins the interpreter evaluates for real (on known values only),
// plus calls into auth libraries that tell us how a route is protected.
import fs from 'node:fs';
import path from 'node:path';
import { U, UNDEF, NULL, unknown, str, num, bool, obj, arr, native, fromJs, pkgPath, jsValue } from './values.js';
import { bunServe, denoServe } from '../frameworks/routers.js';

const MAX_READ = 1024 * 1024;

function s(v) {
  return v && v.k === 's' ? v.v : undefined;
}

function allStrings(args) {
  const out = [];
  for (const a of args) {
    if (!a || (a.k !== 's' && a.k !== 'n')) return null;
    out.push(String(a.v));
  }
  return out;
}

function insideRoot(interp, p) {
  const rel = path.relative(interp.root, p);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function typeHint(interp, v, type) {
  const col = interp.analyzing;
  if (col && v && v.k === 'role' && v.role === 'field' && v.path.length) col.setType(v.loc, v.path, type);
}

// --- globals: Object, Array, JSON, Promise, String/Number/Boolean, parseInt, Bun, Deno ----------

function globalCall(interp, name, args, node) {
  switch (name) {
    case 'Object.keys': {
      const o = args[0];
      if (o && o.k === 'o') return arr([...(o.nsRec ? interp.exportNames(o.nsRec) : o.props.keys())].map((k) => str(k)));
      if (o && o.k === 'a') return arr(o.items.map((_, i) => str(String(i))));
      return U;
    }
    case 'Object.values': {
      const o = args[0];
      if (o && o.k === 'o') return arr(o.nsRec ? [...interp.exportNames(o.nsRec)].map((n) => interp.getExport(o.nsRec, n)) : [...o.props.values()]);
      return U;
    }
    case 'Object.entries': {
      const o = args[0];
      if (o && o.k === 'o') {
        const keys = o.nsRec ? [...interp.exportNames(o.nsRec)] : [...o.props.keys()];
        return arr(keys.map((k) => arr([str(k), o.nsRec ? interp.getExport(o.nsRec, k) : o.props.get(k)])));
      }
      return U;
    }
    case 'Object.assign': {
      const [target, ...sources] = args;
      if (target && target.k === 'o') {
        for (const src of sources) if (src && src.k === 'o') for (const [k, v] of src.props) target.props.set(k, v);
        return target;
      }
      return target || U;
    }
    case 'Object.fromEntries': {
      const list = args[0];
      if (list && list.k === 'a') {
        const o = obj();
        for (const e of list.items) if (e.k === 'a' && e.items[0] && (e.items[0].k === 's' || e.items[0].k === 'n')) o.props.set(String(e.items[0].v), e.items[1] || UNDEF);
        return o;
      }
      return U;
    }
    case 'Object.freeze': case 'Object.seal': case 'Object.preventExtensions':
      return args[0] || U;
    case 'Object.create': return obj();
    case 'Array.isArray': typeHint(interp, args[0], 'array'); return args[0] && args[0].k === 'a' ? bool(true) : U;
    case 'Array.from': {
      const a = args[0];
      if (a && a.k === 'a') return args[1] && args[1].k === 'f' ? interp.arrayMethod(a, 'map', [args[1]], node) : arr([...a.items]);
      if (a && a.k === 'o' && a.mapEntries) return arr([...a.mapEntries]);
      return U;
    }
    case 'Array.of': return arr(args);
    case 'JSON.parse': {
      const t = s(args[0]);
      if (t !== undefined) {
        try {
          return fromJs(JSON.parse(t));
        } catch {
          return U;
        }
      }
      if (args[0] && args[0].k === 'role') return interp.hooks.roleBody ? interp.hooks.roleBody(interp, args[0]) : U;
      return U;
    }
    case 'JSON.stringify': return U;
    case 'Promise.all': case 'Promise.allSettled': case 'Promise.race': case 'Promise.any':
      return args[0] && args[0].k === 'a' ? args[0] : U;
    case 'Promise.resolve': return args[0] || UNDEF;
    case 'String': typeHint(interp, args[0], 'string'); return args[0] && (args[0].k === 's' || args[0].k === 'role') ? args[0] : U;
    case 'Number': case 'parseFloat':
      typeHint(interp, args[0], 'number');
      if (args[0] && args[0].k === 's' && args[0].v.trim() && !Number.isNaN(Number(args[0].v))) return num(Number(args[0].v));
      return args[0] && args[0].k === 'n' ? args[0] : U;
    case 'parseInt': case 'Number.parseInt':
      typeHint(interp, args[0], 'integer');
      if (args[0] && args[0].k === 's' && /^\s*-?\d+/.test(args[0].v)) return num(parseInt(args[0].v, 10));
      return args[0] && args[0].k === 'n' ? num(Math.trunc(args[0].v)) : U;
    case 'Number.isInteger': typeHint(interp, args[0], 'integer'); return U;
    case 'Date.parse': case 'Date': typeHint(interp, args[0], 'datetime'); return U;
    case 'Boolean': typeHint(interp, args[0], 'boolean'); return U;
    case 'Bun.serve': return bunServe(interp, args, node);
    case 'Deno.serve': return denoServe(interp, args, node);
    case 'Deno.env.get': {
      const k = s(args[0]);
      return k !== undefined && interp.env.has(k) ? str(interp.env.get(k)) : UNDEF;
    }
    case 'Bun.file': return U;
    default:
      return undefined;
  }
}

// --- node:path / node:fs / node:url / node:module / glob ---------------------------------------

function pathCall(interp, fnName, args) {
  const a = allStrings(args);
  switch (fnName) {
    case 'join': case 'posix.join': return a ? str(path.join(...a)) : partialJoin(args);
    case 'resolve': case 'posix.resolve': return a ? str(path.resolve(interp.root, ...a)) : U;
    case 'dirname': return a ? str(path.dirname(a[0])) : U;
    case 'basename': return a ? str(path.basename(a[0], a[1])) : U;
    case 'extname': return a ? str(path.extname(a[0])) : U;
    case 'relative': return a ? str(path.relative(a[0], a[1])) : U;
    case 'normalize': return a ? str(path.normalize(a[0])) : U;
    case 'parse': {
      if (!a) return U;
      const p = path.parse(a[0]);
      return fromJs(p);
    }
    default: return U;
  }
}

function partialJoin(args) {
  if (!args.length || args.some((x) => x.k !== 's' && x.k !== 'n')) return U;
  return U;
}

function readdir(interp, args) {
  const dir = s(args[0]);
  if (dir === undefined) return U;
  const full = path.resolve(interp.root, dir);
  if (!insideRoot(interp, full)) return U;
  let names;
  try {
    names = fs.readdirSync(full).sort();
  } catch {
    return arr([]);
  }
  const opts = args[1];
  const withTypes = opts && opts.k === 'o' && opts.props.get('withFileTypes') && opts.props.get('withFileTypes').v;
  if (withTypes) {
    return arr(names.map((n) => {
      let isDir = false;
      try { isDir = fs.statSync(path.join(full, n)).isDirectory(); } catch { /* ignore */ }
      return obj([['name', str(n)], ['isDirectory', native('isDirectory', () => bool(isDir))], ['isFile', native('isFile', () => bool(!isDir))]]);
    }));
  }
  return arr(names.map((n) => str(n)));
}

function fsCall(interp, fnName, args) {
  switch (fnName) {
    case 'readdirSync': case 'readdir': case 'promises.readdir': return readdir(interp, args);
    case 'existsSync': {
      const p = s(args[0]);
      return p === undefined ? U : bool(fs.existsSync(path.resolve(interp.root, p)));
    }
    case 'statSync': case 'lstatSync': case 'stat': case 'promises.stat': {
      const p = s(args[0]);
      if (p === undefined) return U;
      let st = null;
      try { st = fs.statSync(path.resolve(interp.root, p)); } catch { /* ignore */ }
      return obj([['isDirectory', native('isDirectory', () => bool(!!st && st.isDirectory()))], ['isFile', native('isFile', () => bool(!!st && st.isFile()))]]);
    }
    case 'readFileSync': case 'readFile': case 'promises.readFile': {
      const p = s(args[0]);
      if (p === undefined) return U;
      const full = path.resolve(interp.root, p);
      if (!insideRoot(interp, full) || !/\.(json|ya?ml|txt)$/i.test(full)) return U;
      try {
        if (fs.statSync(full).size > MAX_READ) return U;
        return str(fs.readFileSync(full, 'utf8'));
      } catch {
        return U;
      }
    }
    default: return U;
  }
}

/** Minimal glob for route auto-loading: supports *, **, ?, {a,b}. */
function globToRegex(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '(?:.*/)?';
        i += pattern[i + 2] === '/' ? 2 : 1;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = pattern.indexOf('}', i);
      if (end < 0) { re += '\\{'; continue; }
      re += '(?:' + pattern.slice(i + 1, end).split(',').map((x) => x.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|') + ')';
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

function globSync(interp, args) {
  const patterns = args[0] && args[0].k === 'a' ? args[0].items.map(s).filter(Boolean) : [s(args[0])].filter(Boolean);
  if (!patterns.length) return U;
  const opts = args[1];
  const cwdV = opts && opts.k === 'o' ? opts.props.get('cwd') : null;
  const absolute = opts && opts.k === 'o' && opts.props.get('absolute') && opts.props.get('absolute').v;
  const cwd = cwdV && cwdV.k === 's' ? path.resolve(interp.root, cwdV.v) : interp.root;
  const out = [];
  for (const pat of patterns) {
    const abs = path.isAbsolute(pat);
    const base = abs ? '/' : cwd;
    const rel = abs ? pat.slice(1) : pat.replace(/^\.\//, '');
    const fixed = rel.split('/').filter((p, i, all) => !/[*?{]/.test(all.slice(0, i + 1).join('/'))).join('/');
    const start = path.join(base, fixed);
    if (!insideRoot(interp, start) && !insideRoot(interp, start + '/x')) continue;
    const re = globToRegex(rel);
    const walk = (dir, depth) => {
      if (depth > 10 || out.length > 500) return;
      let names;
      try { names = fs.readdirSync(dir); } catch { return; }
      for (const n of names.sort()) {
        if (n === 'node_modules' || n.startsWith('.')) continue;
        const full = path.join(dir, n);
        let isDir = false;
        try { isDir = fs.statSync(full).isDirectory(); } catch { continue; }
        if (isDir) walk(full, depth + 1);
        else {
          const r = path.relative(base, full).split(path.sep).join('/');
          if (re.test(r)) out.push(absolute || abs ? full : (pat.startsWith('./') ? './' : '') + r);
        }
      }
    };
    walk(start, 0);
  }
  return arr(out.map((x) => str(x)));
}

// --- auth libraries --------------------------------------------------------------------------

function authHint(interp, ...hints) {
  const col = interp.analyzing;
  if (col) for (const h of hints) col.hints.add(h);
}

function authPkg(interp, p, args) {
  const name = p.pkg;
  const sig = pkgPath(p).replace(/^default\./, '');
  const col = interp.analyzing;
  // a token taken from the request body (refresh/verify-email endpoints) does not authenticate the request
  const fromBody = args[0] && args[0].k === 'role' && args[0].role === 'field' && (args[0].loc === 'body' || args[0].loc === 'query');
  if (name === 'jsonwebtoken' || name === 'jwt-simple' || name === 'fast-jwt') {
    if ((/(^|\.)(verify|decode)\(\)$/.test(sig) || /createVerifier/.test(sig)) && !fromBody) authHint(interp, 'protect', 'jwt');
    if (/(^|\.)(sign|encode)\(\)$/.test(sig) || /createSigner/.test(sig)) authHint(interp, 'jwt-sign');
    return U;
  }
  if (name === 'jose') {
    if (/jwtVerify\(\)$/.test(sig) && !fromBody) authHint(interp, 'protect', 'jwt');
    if (/SignJWT/.test(sig)) authHint(interp, 'jwt-sign');
    return U;
  }
  if (name === 'bcrypt' || name === 'bcryptjs' || name === 'argon2' || name === '@node-rs/argon2' || name === '@node-rs/bcrypt') {
    if (/(compare|verify)/.test(sig)) authHint(interp, 'password-check');
    return U;
  }
  if (name === 'passport') {
    if (/authenticate\(\)$/.test(sig)) {
      const strategy = s(args[0]) || (args[0] && args[0].k === 'a' && s(args[0].items[0])) || '';
      // called inside a middleware (auth factories wrap it in a Promise): count it for the running handler
      if (interp.analyzing) {
        const st = strategy.toLowerCase();
        if (/jwt|bearer/.test(st)) authHint(interp, 'protect', 'bearer');
        else if (st === 'basic') authHint(interp, 'protect', 'basic');
        else if (/api.?key/.test(st)) authHint(interp, 'protect', 'apikey');
        else if (st === 'local') authHint(interp, 'login-strategy');
      }
      return { k: 'u', name: `passport.authenticate(${strategy})`, passport: strategy };
    }
    return undefined;
  }
  if (name === 'express-jwt' || name === 'koa-jwt' || name === 'express-oauth2-jwt-bearer' || name === 'jwks-rsa') {
    if (/unless\(\)$/.test(sig)) return { k: 'u', name: 'jwt-middleware', authMw: 'bearer', unless: args[0] };
    return { k: 'u', name: 'jwt-middleware', authMw: 'bearer', pkgv: p };
  }
  if (name === 'hono/jwt' || name === 'hono/jwk') {
    if (/^jwt\(\)$|^jwk\(\)$/.test(sig)) return { k: 'u', name: 'hono-jwt', authMw: 'bearer' };
    if (/^verify\(\)$/.test(sig)) authHint(interp, 'protect', 'jwt');
    if (/^sign\(\)$/.test(sig)) authHint(interp, 'jwt-sign');
    return U;
  }
  if (name === 'hono/bearer-auth') return { k: 'u', name: 'bearerAuth', authMw: 'bearer' };
  if (name === 'hono/basic-auth' || name === 'express-basic-auth' || name === 'basic-auth') {
    if (name === 'basic-auth') { authHint(interp, 'protect', 'basic'); return U; }
    return { k: 'u', name: 'basicAuth', authMw: 'basic' };
  }
  if (name === '@clerk/express' || name === '@clerk/fastify' || name === '@hono/clerk-auth' || name === '@clerk/backend') {
    if (/requireAuth|clerkMiddleware|getAuth|authenticateRequest/.test(sig)) return { k: 'u', name: 'clerk', authMw: 'bearer' };
  }
  if (name === 'firebase-admin' || name === 'firebase-admin/auth') {
    if (/verifyIdToken/.test(sig)) authHint(interp, 'protect', 'jwt');
    return undefined;
  }
  if (name === 'better-auth' || name === 'better-auth/node') {
    if (/getSession/.test(sig)) authHint(interp, 'protect', 'session');
    return undefined;
  }
  if (name === 'validator' && col) {
    const target = args[0];
    const m = /(?:^|\.)(is\w+)\(\)$/.exec(sig);
    if (m && target && target.k === 'role') {
      const t = { isEmail: 'email', isURL: 'url', isUUID: 'uuid', isMongoId: 'objectid', isInt: 'integer', isNumeric: 'number', isFloat: 'number', isBoolean: 'boolean', isISO8601: 'datetime', isDate: 'date' }[m[1]];
      if (t) typeHint(interp, target, t);
    }
    return U;
  }
  if (name === 'mongoose') {
    if (/isValidObjectId\(\)$|Types\.ObjectId\.isValid\(\)$|ObjectId\.isValid\(\)$/.test(sig) && args[0] && args[0].k === 'role' && args[0].role === 'param' && col) {
      col.pathTypes.set(args[0].name, 'objectid');
    }
    return undefined;
  }
  return undefined;
}

// --- hook entry points -----------------------------------------------------------------------

export function builtinPkgCall(interp, p, args, isNew, node) {
  const name = p.pkg;
  const sig = pkgPath(p);
  if (name === '#global') {
    const fnName = sig.replace(/\(\)$/, '');
    if (isNew && fnName === 'Map') return mapValue(args[0]);
    if (isNew && fnName === 'URL' && args[0] && args[0].k === 'role') return { k: 'role', role: 'urlObj', col: args[0].col, path: [] };
    return globalCall(interp, fnName, args, node);
  }
  const fnName = sig.replace(/\(\)$/, '').replace(/^default\./, '');
  switch (name) {
    case 'path': case 'path/posix': case 'node:path': return pathCall(interp, fnName.replace(/^path\./, ''), args);
    case 'fs': case 'fs/promises': case 'node:fs': return fsCall(interp, fnName.replace(/^fs\./, ''), args);
    case 'url':
      if (fnName === 'fileURLToPath') { const u = s(args[0]); return u !== undefined ? str(u.replace(/^file:\/\//, '')) : U; }
      if (fnName === 'pathToFileURL') { const u = s(args[0]); return u !== undefined ? obj([['href', str('file://' + u)]]) : U; }
      if (fnName === 'parse' && args[0] && args[0].k === 'role') return { k: 'role', role: 'urlObj', col: args[0].col, path: [] };
      return U;
    case 'module':
      if (fnName === 'createRequire') {
        const from = s(args[0]);
        if (from === undefined) return U;
        const file = from.replace(/^file:\/\//, '');
        return native('require', (a) => (a[0] && a[0].k === 's' ? interp.requireValue(a[0].v, file) : U));
      }
      return U;
    case 'glob': case 'fast-glob': case 'globby': case 'tiny-glob':
      if (/^(sync|globSync|default|glob|globbySync)?$/.test(fnName) || fnName === '' || fnName === 'glob.sync') return globSync(interp, args);
      return U;
    case 'dotenv': case 'dotenv-flow': case '@dotenvx/dotenvx':
      return U;
    default:
      return authPkg(interp, p, args);
  }
}

function mapValue(init) {
  const o = obj();
  o.mapEntries = init && init.k === 'a' ? init.items : [];
  return o;
}

export function builtinPkgGet(interp, p, key) {
  // process.env-like constants, Segments of celebrate, Deno.env
  if (p.pkg === 'celebrate' && p.chain.length === 1 && p.chain[0].get === 'Segments') {
    return str({ BODY: 'body', QUERY: 'query', PARAMS: 'params', HEADERS: 'headers', COOKIES: 'cookies', SIGNED_COOKIES: 'signedCookies' }[key] || key.toLowerCase());
  }
  if ((p.pkg === 'path' || p.pkg === 'node:path') && key === 'sep') return str('/');
  if (p.pkg === '#global' && p.chain.length === 1 && p.chain[0].get === 'Number' && key === 'parseInt') return undefined;
  return undefined;
}

export { jsValue, NULL, unknown };
