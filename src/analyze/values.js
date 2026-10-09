// Abstract values used by the interpreter. Every value is a small object tagged with `k`.
//
//   u  unknown (optionally named: an unresolved identifier or member, used as a hint)
//   s  string        n number        b boolean       null / undef
//   re regular expression literal
//   o  object (props Map, optional proto for class instances)
//   a  array
//   f  function closure (AST node + scope)     nf native function implemented in JS
//   c  class
//   p  external package reference with the chain of gets/calls applied to it
//   r  router / application of a web framework
//   z  validation schema (zod, joi, yup, typebox, valibot, vine, json schema, DTO class)
//   ev express-validator chain
//   role  a request-derived value during handler analysis (req.body, c.req, event, ...)

let nextId = 1;

export const UNDEF = Object.freeze({ k: 'undef' });
export const NULL = Object.freeze({ k: 'null' });
export const U = Object.freeze({ k: 'u', name: '' });

export function unknown(name = '') {
  return name ? { k: 'u', name } : U;
}
export const str = (v) => ({ k: 's', v: String(v) });
export const num = (v) => ({ k: 'n', v });
export const bool = (v) => ({ k: 'b', v: !!v });

export function obj(entries, extra) {
  const o = { k: 'o', props: new Map(entries || []), id: nextId++ };
  return extra ? Object.assign(o, extra) : o;
}
export const arr = (items) => ({ k: 'a', items: items || [], id: nextId++ });

export function fn(node, scope, mod, name = '') {
  return { k: 'f', node, scope, mod, name, id: nextId++ };
}
export function native(name, impl) {
  return { k: 'nf', name, impl };
}
export function pkg(name, chain = []) {
  return { k: 'p', pkg: name, chain };
}
export function pkgGet(p, prop) {
  return pkg(p.pkg, [...p.chain, { get: prop }]);
}
export function pkgCall(p, args, isNew = false, node = null) {
  return pkg(p.pkg, [...p.chain, { call: args, isNew, node }]);
}
/** "Router()" style signature of a package chain, e.g. express.Router() -> "Router()". */
export function pkgPath(p) {
  return p.chain.map((c) => ('get' in c ? '.' + c.get : '()')).join('').replace(/^\./, '');
}
export function pkgArgs(p, index = -1) {
  const calls = p.chain.filter((c) => 'call' in c);
  const c = index < 0 ? calls[calls.length + index] : calls[index];
  return c ? c.call : [];
}

export function newId() {
  return nextId++;
}

export const isStr = (v) => v && v.k === 's';
export const isFn = (v) => v && (v.k === 'f' || v.k === 'nf');
export const isUnknown = (v) => !v || v.k === 'u';

export function jsValue(v, depth = 0) {
  if (!v) return undefined;
  switch (v.k) {
    case 's': case 'n': case 'b': return v.v;
    case 'null': return null;
    case 're': return new RegExpLike(v.source, v.flags);
    case 'a': return depth > 8 ? [] : v.items.map((x) => jsValue(x, depth + 1));
    case 'o': {
      if (depth > 8) return {};
      const out = {};
      for (const [key, val] of v.props) out[key] = jsValue(val, depth + 1);
      return out;
    }
    default: return undefined;
  }
}

/** A regex value that stays inert (we never run user regexes against big inputs). */
export class RegExpLike {
  constructor(source, flags) {
    this.source = source;
    this.flags = flags || '';
  }
}

export function truthy(v) {
  if (!v) return undefined;
  switch (v.k) {
    case 's': return v.v.length > 0;
    case 'n': return v.v !== 0 && !Number.isNaN(v.v);
    case 'b': return v.v;
    case 'null': case 'undef': return false;
    case 'o': case 'a': case 'f': case 'nf': case 'c': case 'r': case 'z': case 're': case 'p': return true;
    default: return undefined;
  }
}

export function fromJs(x, depth = 0) {
  if (x === undefined) return UNDEF;
  if (x === null) return NULL;
  if (typeof x === 'string') return str(x);
  if (typeof x === 'number') return num(x);
  if (typeof x === 'boolean') return bool(x);
  if (Array.isArray(x)) return arr(depth > 8 ? [] : x.map((y) => fromJs(y, depth + 1)));
  if (typeof x === 'object') return obj(depth > 8 ? [] : Object.entries(x).map(([k, v]) => [k, fromJs(v, depth + 1)]));
  return U;
}

export function describe(v) {
  if (!v) return '?';
  switch (v.k) {
    case 'u': return v.name || 'unknown';
    case 's': return JSON.stringify(v.v);
    case 'f': return `function ${v.name || ''}`;
    case 'p': return `${v.pkg}:${pkgPath(v)}`;
    case 'r': return `${v.fw} router`;
    default: return v.k;
  }
}
