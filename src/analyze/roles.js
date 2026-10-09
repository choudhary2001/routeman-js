// Handler analysis: request-derived values ("roles") and the collector that records what a
// handler reads from the request - body/query/header fields, files, auth checks and method branches.
import { NONE } from '../model.js';
import { U, UNDEF, unknown, str, arr, bool, pkgPath } from './values.js';

const STRING_METHODS = new Set(['toLowerCase', 'toUpperCase', 'trim', 'trimStart', 'trimEnd', 'replace', 'replaceAll',
  'split', 'slice', 'substring', 'substr', 'startsWith', 'endsWith', 'padStart', 'padEnd', 'charAt', 'normalize',
  'match', 'matchAll', 'search', 'localeCompare', 'toLocaleLowerCase', 'toLocaleUpperCase', 'codePointAt', 'charCodeAt']);
const ARRAY_METHODS = new Set(['map', 'forEach', 'filter', 'some', 'every', 'reduce', 'find', 'findIndex', 'flatMap',
  'push', 'join', 'sort', 'slice', 'concat', 'indexOf', 'at', 'entries', 'keys', 'values', 'flat', 'reverse']);
const IGNORED_HEADERS = new Set(['content-type', 'accept', 'user-agent', 'host', 'content-length', 'cookie', 'origin',
  'referer', 'referrer', 'connection', 'accept-encoding', 'accept-language', 'x-forwarded-for', 'x-forwarded-proto',
  'x-forwarded-host', 'x-real-ip', 'if-none-match', 'if-modified-since', 'cache-control', 'pragma', 'upgrade',
  'sec-websocket-key', 'x-request-id', 'x-requested-with', 'stripe-signature', 'x-hub-signature', 'x-hub-signature-256']);
export const APIKEY_HEADER = /^(x-)?(api[-_]?key|apikey|api[-_]?token|access[-_]?key|client[-_]?key|secret[-_]?key|app[-_]?key)$/i;
export const TOKEN_HEADER = /^(x-)?(access[-_]?token|auth[-_]?token|token|authorization[-_]?token|jwt|session[-_]?token|id[-_]?token)$/i;

function treeNode() {
  return { children: new Map(), type: null, required: false, default: NONE, choices: new Set(), item: null, methods: null, order: 0, typed: null };
}

/** Collects what one route's handlers read from the request. */
export class Collector {
  constructor(fw) {
    this.fw = fw;
    this.trees = new Map();   // context key -> { body, query, headers: Map, files: Map }
    this.schemas = [];        // { loc, value }
    this.types = [];          // { loc, fields }
    this.mode = null;         // 'form' | 'urlencoded' | 'json'
    this.hints = new Set();
    this.authHeader = null;
    this.tokenPrefix = null;
    this.negLog = [];
    this.condStack = [];
    this.conds = [];          // every (method, path) context that was entered
    this.counter = 0;
    this.pathTypes = new Map();
    // remember the (method, path) context in which auth checks happen (raw node:http / fetch routers)
    this.protectAt = [];
    const col = this;
    const add = this.hints.add.bind(this.hints);
    this.hints.add = (h) => {
      if (h === 'protect') { const c = col.context(); col.protectAt.push({ method: c.method, path: c.path }); }
      return add(h);
    };
  }

  /** Enter a branch condition; records the combined (method, path) context. */
  enter(entry) {
    this.condStack.push(entry);
    const c = this.context();
    this.conds.push({ method: c.method, path: c.path });
  }

  context() {
    let method = null;
    let path = null;
    for (const c of this.condStack) {
      if (c.method) method = c.method;
      if (c.path) path = c.path;
    }
    return { method, path, key: `${method || ''} ${path ? path.kind + ':' + path.value : ''}` };
  }

  tree() {
    const { key, method, path } = this.context();
    let t = this.trees.get(key);
    if (!t) {
      t = { method, path, body: treeNode(), query: treeNode(), headers: new Map(), files: new Map(), params: treeNode() };
      this.trees.set(key, t);
    }
    return t;
  }

  /** Record access to loc/path; returns the tree node. */
  touch(loc, path) {
    const t = this.tree();
    if (loc === 'headers') {
      if (path.length) {
        const name = path[0].toLowerCase();
        this.noteHeader(name);
        if (!t.headers.has(name)) t.headers.set(name, treeNode());
        return t.headers.get(name);
      }
      return null;
    }
    if (loc === 'form') this.mode = this.mode || 'form';
    let root = t[loc === 'form' || loc === 'input' ? 'body' : loc === 'files' ? 'body' : loc];
    if (!root) return null;
    if (loc === 'input') root.input = true;
    if (!path.length) root.touched = true;
    let node = root;
    for (const part of path) {
      if (part === '[]') {
        if (!node.item) node.item = treeNode();
        node.type = node.type || 'array';
        node = node.item;
      } else {
        if (!node.children.has(part)) {
          const child = treeNode();
          child.order = this.counter++;
          node.children.set(part, child);
        }
        node = node.children.get(part);
      }
    }
    if (node !== root && loc === 'files') node.type = 'file';
    if (node !== root && loc === 'input') node.input = true;
    return node;
  }

  noteHeader(name) {
    if (name === 'authorization') this.hints.add('authz-header');
    else if (APIKEY_HEADER.test(name)) {
      this.hints.add('apikey');
      this.authHeader = this.authHeader || name;
    } else if (TOKEN_HEADER.test(name)) {
      this.hints.add('header-token');
      this.authHeader = this.authHeader || name;
    }
  }

  setType(loc, path, type, force = false) {
    const node = this.touch(loc, path);
    if (!node) return;
    if (force || !node.type || node.type === 'any' || (node.type === 'string' && ['email', 'url', 'uuid', 'objectid', 'date', 'datetime', 'file', 'integer', 'number', 'boolean'].includes(type))) {
      if (!(node.type === 'integer' && type === 'number')) node.type = type;
    }
  }

  file(name, many = false) {
    const t = this.tree();
    this.mode = 'form';
    t.files.set(name, { many });
  }
}

export function role(kind, col, extra) {
  return { k: 'role', role: kind, col, path: [], loc: null, ...extra };
}
function field(col, loc, path) {
  return { k: 'role', role: 'field', col, loc, path };
}
function rootOf(col, loc) {
  col.touch(loc, []);
  return field(col, loc, []);
}

// --- member access ---------------------------------------------------------------------------

const REQ_MEMBERS = {
  body: (c) => rootOf(c, 'body'),
  payload: (c) => rootOf(c, 'body'),
  query: (c) => rootOf(c, 'query'),
  params: (c) => role('params', c),
  headers: (c) => role('headers', c),
  file: (c) => role('reqfile', c),
  files: (c) => role('reqfiles', c),
  method: (c) => role('method', c),
  url: (c) => role('url', c),
  originalUrl: (c) => role('url', c),
  path: (c) => role('pathname', c),
  pathname: (c) => role('pathname', c),
  session: (c) => role('session', c),
  cookies: () => unknown('req.cookies'),
  signedCookies: () => unknown('req.cookies'),
  user: (c) => { c.hints.add('reads-user'); return unknown('req.user'); },
  auth: (c) => { c.hints.add('reads-user'); return unknown('req.auth'); },
  raw: (c) => role('nodeReq', c),
  req: (c) => role('nodeReq', c),
  fields: (c) => { c.mode = 'form'; return rootOf(c, 'form'); },
  validated: (c) => rootOf(c, 'body'),
};

function getMember(interp, v, key) {
  const c = v.col;
  switch (v.role) {
    case 'field': return fieldGet(interp, v, key);
    case 'req':
    case 'nodeReq': {
      if (v.role === 'nodeReq' && key === 'body') { c.hints.add('raw-body'); return rootOf(c, 'body'); }
      const f = REQ_MEMBERS[key];
      if (f) return f(c);
      if (key === 'header' || key === 'get') return role('headerGetter', c);
      return unknown('req.' + key);
    }
    case 'ittyReq': {
      if (key === 'content') return rootOf(c, 'body');
      if (key === 'params') return role('params', c);
      if (key === 'query') return rootOf(c, 'query');
      return getMember(interp, { ...v, role: 'fetchReq' }, key);
    }
    case 'params': return { k: 'role', role: 'param', col: c, name: key, path: [key] };
    case 'headers': {
      c.touch('headers', [key]);
      return { k: 'role', role: 'header', col: c, name: key.toLowerCase(), path: [key] };
    }
    case 'reqfile': return unknown('req.file.' + key);
    case 'reqfiles': {
      if (!/^\d+$/.test(key) && !ARRAY_METHODS.has(key) && key !== 'length') c.file(key);
      return unknown('req.files.' + key);
    }
    case 'session': return { k: 'role', role: 'sessionKey', col: c, name: key };
    case 'sessionKey': return unknown('session.' + v.name + '.' + key);
    case 'ctx': {
      if (key === 'request') return role(c.fw === 'oak' ? 'oakRequest' : 'koaRequest', c);
      if (key === 'req') return role('req', c);
      if (key === 'query') return rootOf(c, 'query');
      if (key === 'params') return role('params', c);
      if (key === 'headers' || key === 'header') return role('headers', c);
      if (key === 'method') return role('method', c);
      if (key === 'url' || key === 'originalUrl') return role('url', c);
      if (key === 'path') return role('pathname', c);
      if (key === 'session') return role('session', c);
      if (key === 'get') return role('headerGetter', c);
      if (key === 'state') return unknown('ctx.state');
      return unknown('ctx.' + key);
    }
    case 'koaRequest': {
      if (key === 'body') return rootOf(c, 'body');
      if (key === 'query') return rootOf(c, 'query');
      if (key === 'files') return role('reqfiles', c);
      if (key === 'file') return role('reqfile', c);
      if (key === 'headers' || key === 'header') return role('headers', c);
      if (key === 'get') return role('headerGetter', c);
      if (key === 'method') return role('method', c);
      if (key === 'url') return role('url', c);
      if (key === 'path') return role('pathname', c);
      return unknown('request.' + key);
    }
    case 'oakRequest': {
      if (key === 'body') return role('oakBody', c);
      if (key === 'url') return role('urlObj', c);
      if (key === 'headers') return role('fetchHeaders', c);
      if (key === 'method') return role('method', c);
      return unknown('request.' + key);
    }
    case 'oakBody': {
      if (key === 'value') return rootOf(c, 'body');
      return unknown('body.' + key);
    }
    case 'honoCtx': {
      if (key === 'req') return role('honoReq', c);
      if (key === 'env' || key === 'var') return unknown('c.' + key);
      return unknown('c.' + key);
    }
    case 'honoReq': {
      if (key === 'raw') return role('fetchReq', c);
      if (key === 'method') return role('method', c);
      if (key === 'url') return role('url', c);
      if (key === 'path') return role('pathname', c);
      return unknown('c.req.' + key);
    }
    case 'fetchReq': {
      if (key === 'headers') return role('fetchHeaders', c);
      if (key === 'url') return role('url', c);
      if (key === 'nextUrl') return role('urlObj', c);
      if (key === 'method') return role('method', c);
      if (key === 'params') return role('params', c);
      if (key === 'cookies') return unknown('request.cookies');
      if (key === 'body') return unknown('request.body');
      return unknown('request.' + key);
    }
    case 'fetchHeaders': return unknown('headers.' + key);
    case 'url': {
      if (key === 'searchParams') return role('searchParams', c);
      if (key === 'pathname') return role('pathname', c);
      if (key === 'query') return rootOf(c, 'query');
      return unknown('url.' + key);
    }
    case 'urlObj': {
      if (key === 'searchParams') return role('searchParams', c);
      if (key === 'pathname') return role('pathname', c);
      if (key === 'query') return rootOf(c, 'query');
      return unknown('url.' + key);
    }
    case 'elysiaCtx': {
      if (key === 'body') return rootOf(c, 'body');
      if (key === 'query') return rootOf(c, 'query');
      if (key === 'params') return role('params', c);
      if (key === 'headers') return role('headers', c);
      if (key === 'request') return role('fetchReq', c);
      if (key === 'path') return role('pathname', c);
      if (key === 'bearer') { c.hints.add('protect'); c.hints.add('bearer'); return unknown('bearer'); }
      if (key === 'jwt') return role('elysiaJwt', c);
      if (key === 'cookie') return unknown('cookie');
      if (key === 'user' || key === 'session' || key === 'auth') { c.hints.add('reads-user'); return unknown(key); }
      return unknown(key);
    }
    case 'elysiaJwt': return unknown('jwt.' + key);
    case 'hapiReq': {
      if (key === 'payload') return rootOf(c, 'body');
      if (key === 'query') return rootOf(c, 'query');
      if (key === 'params') return role('params', c);
      if (key === 'headers') return role('headers', c);
      if (key === 'method') return role('method', c);
      if (key === 'auth') { c.hints.add('reads-user'); return unknown('request.auth'); }
      return unknown('request.' + key);
    }
    case 'event': {
      if (key === 'context') return role('eventContext', c);
      if (key === 'node') return role('eventNode', c);
      if (key === 'req' || key === 'request') return role('fetchReq', c);
      if (key === 'url') return role('urlObj', c);
      if (key === 'method') return role('method', c);
      if (key === 'path') return role('pathname', c);
      if (key === 'headers') return role('fetchHeaders', c);
      return unknown('event.' + key);
    }
    case 'eventContext': {
      if (key === 'params') return role('params', c);
      if (key === 'user' || key === 'auth' || key === 'session') { c.hints.add('reads-user'); return unknown('event.context.' + key); }
      return unknown('event.context.' + key);
    }
    case 'eventNode': {
      if (key === 'req') return role('nodeReq', c);
      return unknown('event.node.' + key);
    }
    case 'kitEvent': {
      if (key === 'request') return role('fetchReq', c);
      if (key === 'url') return role('urlObj', c);
      if (key === 'params') return role('params', c);
      if (key === 'locals') return unknown('locals');
      return unknown(key);
    }
    case 'nextCtx': {
      if (key === 'params') return role('params', c);
      return unknown(key);
    }
    case 'adonisCtx': {
      if (key === 'request') return role('adonisReq', c);
      if (key === 'params') return role('params', c);
      if (key === 'auth') return role('adonisAuth', c);
      return unknown(key);
    }
    case 'adonisAuth': {
      if (key === 'user') { c.hints.add('reads-user'); }
      return role('adonisAuth', c);
    }
    case 'adonisReq': {
      if (key === 'method') return role('method', c);
      return unknown('request.' + key);
    }
    case 'searchParams': return unknown('searchParams.' + key);
    case 'formData': return unknown('formData.' + key);
    default: return unknown(key);
  }
}

function fieldGet(interp, v, key) {
  const c = v.col;
  if (v.loc === 'headers' || v.loc === 'params') return U;
  if (key === 'length') return U;
  if (key === '[]' || /^\d+$/.test(key)) {
    c.touch(v.loc, [...v.path, '[]']);
    return field(c, v.loc, [...v.path, '[]']);
  }
  if (key === 'toString' || key === 'valueOf' || key === 'constructor' || key === 'hasOwnProperty') return U;
  const path = [...v.path, key];
  c.touch(v.loc, path);
  return field(c, v.loc, path);
}

// --- method calls ----------------------------------------------------------------------------

function headerValue(c, name) {
  c.touch('headers', [name]);
  return { k: 'role', role: 'header', col: c, name: String(name).toLowerCase(), path: [name] };
}

function argStr(args, i) {
  const a = args[i];
  return a && a.k === 's' ? a.v : null;
}

function authFromString(c, s) {
  if (!s) return;
  if (/^bearer\b/i.test(s)) c.hints.add('bearer');
  else if (/^basic\b/i.test(s)) c.hints.add('basic');
  else if (/^(token|jwt)\b/i.test(s)) { c.hints.add('token'); c.tokenPrefix = s.trim().split(/\s+/)[0]; }
}

function callMethod(interp, v, key, args, node) {
  const c = v.col;
  switch (v.role) {
    case 'field': {
      if (STRING_METHODS.has(key)) {
        if (v.loc === 'body' || v.loc === 'query' || v.loc === 'form' || v.loc === 'input') c.setType(v.loc, v.path, 'string');
        if ((key === 'match' || key === 'search') && args[0] && args[0].k === 're' && v.path.length) {
          const node = c.touch(v.loc, v.path);
          if (node) node.pattern = args[0].source;
        }
        if (key === 'split' || key === 'match') return arr([U, U]);
        if (['trim', 'toLowerCase', 'toUpperCase', 'normalize', 'trimStart', 'trimEnd'].includes(key)) return v;
        return U;
      }
      if (ARRAY_METHODS.has(key)) {
        if (['map', 'forEach', 'filter', 'some', 'every', 'find', 'findIndex', 'flatMap', 'reduce'].includes(key)) {
          c.setType(v.loc, v.path, 'array');
          const item = field(c, v.loc, [...v.path, '[]']);
          c.touch(v.loc, [...v.path, '[]']);
          const cb = args[0];
          if (cb && cb.k === 'f') interp.callFunction(cb, key === 'reduce' ? [U, item] : [item, U], UNDEF, node);
          return key === 'map' || key === 'filter' ? arr([item]) : U;
        }
        if (key === 'join' || key === 'push') c.setType(v.loc, v.path, 'array');
        return U;
      }
      if (key === 'toString') return U;
      return U;
    }
    case 'header': {
      if (v.name === 'authorization') {
        if (['split', 'replace', 'startsWith', 'slice', 'substring', 'match', 'includes', 'indexOf'].includes(key)) {
          const s = argStr(args, 0);
          if (s) authFromString(c, s);
          else if (key === 'split' || key === 'slice' || key === 'substring') c.hints.add('bearer');
          if (args[0] && args[0].k === 're') authFromString(c, args[0].source.replace(/^\^/, ''));
        }
        if (key === 'split') return arr([U, unknown('token')]);
      }
      return U;
    }
    case 'headerGetter': return U;
    case 'req':
    case 'nodeReq': {
      if (key === 'get' || key === 'header') {
        const name = argStr(args, 0);
        return name ? headerValue(c, name) : U;
      }
      if (key === 'isAuthenticated') { c.hints.add('protect'); c.hints.add('session'); return U; }
      if (key === 'jwtVerify') { c.hints.add('protect'); c.hints.add('bearer'); return U; }
      if (key === 'file') { c.file('file'); return U; }
      if (key === 'files' || key === 'saveRequestFiles') { c.file('files', true); return U; }
      if (key === 'parts') { c.mode = 'form'; return U; }
      if (key === 'login' || key === 'logIn') { c.hints.add('session-login'); return U; }
      if (key === 'on') return U;
      return undefined;
    }
    case 'ctx': {
      if (key === 'get') {
        const name = argStr(args, 0);
        return name ? headerValue(c, name) : U;
      }
      if (key === 'throw' || key === 'assert') return U;
      return undefined;
    }
    case 'koaRequest': {
      if (key === 'get') {
        const name = argStr(args, 0);
        return name ? headerValue(c, name) : U;
      }
      return undefined;
    }
    case 'oakRequest': {
      if (key === 'body') return role('oakBody', c); // oak <= v11: ctx.request.body()
      return undefined;
    }
    case 'oakBody': {
      if (key === 'json') return rootOf(c, 'body');
      if (key === 'form') { c.mode = c.mode || 'urlencoded'; return rootOf(c, 'body'); }
      if (key === 'formData') { c.mode = 'form'; return role('formData', c); }
      return U;
    }
    case 'honoReq': {
      switch (key) {
        case 'json': return rootOf(c, 'body');
        case 'parseBody': c.mode = c.mode || 'form'; return rootOf(c, 'form');
        case 'formData': c.mode = 'form'; return role('formData', c);
        case 'query': {
          const name = argStr(args, 0);
          if (!name) return rootOf(c, 'query');
          c.touch('query', [name]);
          return field(c, 'query', [name]);
        }
        case 'queries': {
          const name = argStr(args, 0);
          if (!name) return rootOf(c, 'query');
          c.setType('query', [name], 'array');
          return arr([field(c, 'query', [name])]);
        }
        case 'param': {
          const name = argStr(args, 0);
          return name ? { k: 'role', role: 'param', col: c, name, path: [name] } : role('params', c);
        }
        case 'header': {
          const name = argStr(args, 0);
          return name ? headerValue(c, name) : role('headers', c);
        }
        case 'valid': {
          const target = argStr(args, 0) || 'json';
          if (target === 'query') return rootOf(c, 'query');
          if (target === 'param') return role('params', c);
          if (target === 'header') return role('headers', c);
          if (target === 'form') { c.mode = c.mode || 'form'; return rootOf(c, 'form'); }
          return rootOf(c, 'body');
        }
        case 'text': case 'arrayBuffer': case 'blob': c.hints.add('raw-body'); return U;
        default: return undefined;
      }
    }
    case 'fetchReq':
    case 'ittyReq': {
      if (key === 'json') return rootOf(c, 'body');
      if (key === 'formData') { c.mode = 'form'; return role('formData', c); }
      if (key === 'text' || key === 'arrayBuffer' || key === 'blob') { c.hints.add('raw-body'); return U; }
      return undefined;
    }
    case 'fetchHeaders': {
      if (key === 'get' || key === 'has') {
        const name = argStr(args, 0);
        return name ? headerValue(c, name) : U;
      }
      return U;
    }
    case 'formData': {
      const name = argStr(args, 0);
      if (!name) return U;
      if (key === 'get' || key === 'has') { c.touch('form', [name]); return field(c, 'form', [name]); }
      if (key === 'getAll') { c.setType('form', [name], 'array'); return arr([field(c, 'form', [name, '[]'])]); }
      return U;
    }
    case 'searchParams': {
      const name = argStr(args, 0);
      if (!name) return U;
      if (key === 'get' || key === 'has') { c.touch('query', [name]); return field(c, 'query', [name]); }
      if (key === 'getAll') { c.setType('query', [name], 'array'); return arr([field(c, 'query', [name])]); }
      return U;
    }
    case 'url':
    case 'pathname': {
      if (key === 'startsWith' || key === 'match' || key === 'test') {
        const s = argStr(args, 0);
        if (s) return { k: 'cond', path: { kind: 'prefix', value: s } };
        if (args[0] && args[0].k === 're') return { k: 'cond', path: { kind: 'regex', value: args[0].source } };
      }
      if (key === 'split') return arr([U, U, U]);
      return U;
    }
    case 'method': {
      if (key === 'toUpperCase' || key === 'toLowerCase') return v;
      return U;
    }
    case 'elysiaJwt': {
      if (key === 'verify') { c.hints.add('protect'); c.hints.add('bearer'); }
      if (key === 'sign') c.hints.add('jwt-sign');
      return U;
    }
    case 'adonisReq': {
      switch (key) {
        case 'input': {
          const name = argStr(args, 0);
          if (!name) return U;
          c.touch('input', [name]);
          if (args[1]) roleDefault(interp, field(c, 'input', [name]), args[1]);
          return field(c, 'input', [name]);
        }
        case 'only': {
          const list = args[0];
          if (list && list.k === 'a') for (const it of list.items) if (it.k === 's') c.touch('input', [it.v]);
          return rootOf(c, 'input');
        }
        case 'all': case 'body': case 'except': return rootOf(c, 'input');
        case 'qs': return rootOf(c, 'query');
        case 'file': {
          const name = argStr(args, 0);
          if (name) c.file(name);
          return U;
        }
        case 'files': case 'allFiles': {
          const name = argStr(args, 0);
          if (name) c.file(name, true);
          return U;
        }
        case 'header': {
          const name = argStr(args, 0);
          return name ? headerValue(c, name) : U;
        }
        case 'validateUsing': {
          if (args[0]) c.schemas.push({ loc: 'body', value: args[0] });
          return rootOf(c, 'body');
        }
        default: return U;
      }
    }
    case 'adonisAuth': {
      if (['authenticate', 'check', 'authenticateUsing', 'getUserOrFail'].includes(key)) c.hints.add('protect');
      if (key === 'use') return v;
      if (key === 'attempt' || key === 'login' || key === 'verifyCredentials') c.hints.add('session-login');
      return U;
    }
    case 'session': {
      return U;
    }
    default:
      return undefined;
  }
}

// --- types, defaults, conditions -------------------------------------------------------------

function typeOfValue(d) {
  switch (d.k) {
    case 'n': return Number.isInteger(d.v) ? 'integer' : 'number';
    case 'b': return 'boolean';
    case 's': return 'string';
    case 'a': return 'array';
    case 'o': return 'object';
    default: return null;
  }
}

export function roleDefault(interp, v, d) {
  if (!v || v.k !== 'role' || v.role !== 'field' || !d) return;
  if (v.loc === 'headers' || !v.path.length) return;
  const node = v.col.touch(v.loc, v.path);
  if (!node) return;
  const t = typeOfValue(d);
  if (t && (!node.type || node.type === 'any')) node.type = t;
  if (d.k === 's' || d.k === 'n' || d.k === 'b') node.default = d.v;
}

function exits(stmt) {
  if (!stmt) return false;
  if (stmt.type === 'ReturnStatement' || stmt.type === 'ThrowStatement') return true;
  if (stmt.type === 'BlockStatement') return stmt.body.some((s) => exits(s));
  if (stmt.type === 'ExpressionStatement') {
    const src = stmt.expression;
    if (src.type === 'CallExpression' && src.callee.type === 'MemberExpression') {
      const name = src.callee.property.name;
      if (['status', 'sendStatus', 'code', 'throw', 'badRequest', 'unprocessableEntity'].includes(name)) return true;
      if (src.callee.object.type === 'CallExpression') return exits({ type: 'ExpressionStatement', expression: src.callee.object });
    }
    if (src.type === 'CallExpression' && src.callee.type === 'Identifier' && /^(next|error|fail|reject|createError|badRequest)$/.test(src.callee.name)) return true;
  }
  return false;
}

function negatable(v) {
  return v && v.k === 'role' && v.role === 'field' && v.path.length && v.loc !== 'headers' && v.loc !== 'params';
}

const hooks = {
  roleGet: (interp, v, key) => getMember(interp, v, key),
  roleMethod: (interp, v, key, args, node) => callMethod(interp, v, key, args, node),
  roleCall: (interp, v) => {
    if (v.role === 'oakBody') return v;
    if (v.role === 'headerGetter') return U;
    return U;
  },
  roleSet: (interp, v, key) => {
    if (v.role === 'session') v.col.hints.add('session-login');
    else if (v.role === 'sessionKey') v.col.hints.add('session-login');
    else if (v.role === 'field' && v.loc === 'body' && !v.path.length) v.col.hints.add('body-write:' + key);
  },
  roleDefault: (interp, v, d) => roleDefault(interp, v, d),
  onUnary: (interp, op, v) => {
    const col = interp.analyzing;
    if (!col) return null;
    if (op === '!' && negatable(v)) {
      col.negLog.push(v);
      return { k: 'u', name: '' };
    }
    if (op === 'typeof' && v.k === 'role' && v.role === 'field') return { k: 'typeof', target: v };
    if (op === '+' && v.k === 'role' && v.role === 'field') { col.setType(v.loc, v.path, 'number'); return U; }
    return null;
  },
  onBinary: (interp, op, l, r) => {
    const col = interp.analyzing;
    if (!col) return null;
    const eq = op === '===' || op === '==';
    const ne = op === '!==' || op === '!=';
    if (l.k === 'cond' || r.k === 'cond') return null;
    if (l.k === 'typeof' && r.k === 's' && (eq || ne)) {
      const t = { string: 'string', number: 'number', boolean: 'boolean', object: 'object' }[r.v];
      if (t && l.target.path.length) col.setType(l.target.loc, l.target.path, t);
      return null;
    }
    if (op === 'instanceof' && l.k === 'role' && l.role === 'field' && r.k === 'u' && /^(File|Blob)$/.test(r.name)) {
      col.setType(l.loc, l.path, 'file', true);
      col.mode = 'form';
      return null;
    }
    const [a, b] = l.k === 'role' ? [l, r] : [r, l];
    if (a.k !== 'role') return null;
    if (a.role === 'method' && b.k === 's' && (eq || ne)) {
      return { k: 'cond', method: b.v.toUpperCase(), negate: ne };
    }
    if ((a.role === 'url' || a.role === 'pathname') && b.k === 's' && (eq || ne)) {
      return { k: 'cond', path: { kind: 'eq', value: b.v.split('?')[0] }, negate: ne };
    }
    if (a.role === 'field') {
      if ((eq || ne) && (b.k === 'undef' || b.k === 'null')) {
        if (eq) col.negLog.push(a);
        return null;
      }
      if ((eq || ne) && b.k === 's' && b.v !== '' && a.loc !== 'headers' && a.loc !== 'params') {
        const node = col.touch(a.loc, a.path);
        if (node) node.choices.add(b.v);
        return null;
      }
      if ((eq || ne) && b.k === 'n') {
        col.setType(a.loc, a.path, Number.isInteger(b.v) ? 'integer' : 'number');
        return null;
      }
      if ((eq || ne) && b.k === 'b') {
        col.setType(a.loc, a.path, 'boolean');
        return null;
      }
      if (['<', '>', '<=', '>=', '-', '*', '/', '%'].includes(op)) col.setType(a.loc, a.path, 'number');
    }
    if (l.k === 'typeof' && r.k === 's' && (eq || ne)) {
      const t = { string: 'string', number: 'number', boolean: 'boolean', object: 'object' }[r.v];
      if (t) col.setType(l.target.loc, l.target.path, t);
    }
    return null;
  },
  onIf: (interp, test, node, start) => {
    const col = interp.analyzing;
    if (!col) return null;
    const negs = col.negLog.slice(start);
    if (negs.length && exits(node.consequent)) {
      for (const v of negs) {
        const n = col.touch(v.loc, v.path);
        if (n && n.default === NONE) n.required = true;
      }
    }
    if (test && test.k === 'cond' && test.negate && !test.and && exits(node.consequent)) {
      // if (req.method !== 'POST') return 405;  -> the rest of the handler is the POST branch
      col.enter({ method: test.method || null, path: test.path || null });
      return null;
    }
    if (test && test.k === 'cond') {
      // a && b: one combined entry
      const combined = { method: null, path: null };
      let usable = true;
      const add = (cond) => {
        if (cond.and) { for (const x of cond.and) add(x); return; }
        if (cond.negate) { usable = false; return; }
        if (cond.method) combined.method = cond.method;
        if (cond.path) combined.path = cond.path;
      };
      add(test);
      const entries = usable && (combined.method || combined.path) ? [combined] : [];
      const elseEntries = [];
      if (!test.and && test.negate) elseEntries.push({ method: test.method || null, path: test.path || null });
      return {
        enter(which) {
          const list = which === 'then' ? entries : elseEntries;
          for (const e of list) col.enter(e);
          this.pushed = list.length;
        },
        leave() {
          for (let i = 0; i < this.pushed; i++) col.condStack.pop();
        },
      };
    }
    return null;
  },
  onCase: (interp, disc, test) => {
    const col = interp.analyzing;
    if (!col || !disc || disc.k !== 'role' || !test || test.k !== 's') return null;
    let entry = null;
    if (disc.role === 'method') entry = { method: test.v.toUpperCase(), path: null };
    else if (disc.role === 'url' || disc.role === 'pathname') entry = { method: null, path: { kind: 'eq', value: test.v } };
    if (!entry) return null;
    return {
      enter() { col.enter(entry); },
      leave() { col.condStack.pop(); },
    };
  },
};

/** `a && b` of two conditions: both apply. */
export function andCond(l, r) {
  if (l && l.k === 'cond' && r && r.k === 'cond') return { k: 'cond', and: [l, r] };
  return null;
}

export const roleHooks = hooks;

/** Names that make a middleware an authentication check. */
export const AUTH_NAME = /(^|[^a-z])(auth|authenticate|authenticated|authorize|authorized|protect|protected|require_?login|require_?user|require_?signin|is_?logged_?in|logged_?in|ensure_?logged_?in|verify_?token|verify_?jwt|check_?token|check_?jwt|jwt|guard|passport|bearer|api_?key|session_?check|require_?session|current_?user|is_?admin|admin_?only|require_?admin|require_?role|has_?role|check_?role|permission|clerk|firebase_?auth|supabase_?auth)/i;
const AUTH_CAMEL = /(auth|protect|jwt|token|logged|guard|bearer|apikey|session|permission|role|admin|signin)/i;

export function authName(name) {
  if (!name) return false;
  const n = String(name).split('.').pop().replace(/\(\)$/, '');
  if (/^(cors|helmet|morgan|logger|json|urlencoded|static|compression|rateLimit|limiter|cookieParser|bodyParser|errorHandler|notFound|validate|validator|upload|multer|catchAsync|asyncHandler|tryCatch|wrap|handle)$/i.test(n)) return false;
  if (/^(public|optional|skip|no)_?auth|optional/i.test(n)) return false;
  return AUTH_CAMEL.test(n);
}

export { pkgPath, bool, str };
