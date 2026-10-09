// Framework-neutral description of an HTTP API, filled in by the analyzers.

/** Field types understood by the example generator and the Postman writer. */
export const TYPES = [
  'string', 'integer', 'number', 'boolean', 'array', 'object', 'file',
  'uuid', 'objectid', 'date', 'datetime', 'time', 'email', 'url', 'any',
];

/** Marks "no value" for example/default (undefined is a legitimate default in JS). */
export const NONE = Symbol('none');

/**
 * @typedef {object} Field
 * @property {string} name
 * @property {string} type
 * @property {boolean} required
 * @property {string} description
 * @property {any} default
 * @property {any} example
 * @property {any[]|null} choices
 * @property {Field|null} item       element of an array
 * @property {Field[]|null} children members of an object
 * @property {object} [limits]       {min, max, minLength, maxLength, pattern, minItems}
 */

/** @returns {Field} */
export function field(name, type = 'string', extra = {}) {
  return {
    name, type, required: false, description: '', default: NONE, example: NONE,
    choices: null, item: null, children: null, ...extra,
  };
}

export function cloneField(f) {
  if (!f) return f;
  return {
    ...f,
    choices: f.choices ? [...f.choices] : null,
    item: f.item ? cloneField(f.item) : null,
    children: f.children ? f.children.map(cloneField) : null,
    limits: f.limits ? { ...f.limits } : undefined,
  };
}

export function hasFile(f) {
  if (!f) return false;
  if (f.type === 'file') return true;
  if (f.item && hasFile(f.item)) return true;
  return (f.children || []).some(hasFile);
}

/**
 * @typedef {object} Body
 * @property {'json'|'form'|'urlencoded'|'raw'} mode
 * @property {Field[]} fields
 * @property {any} example
 * @property {boolean} partial  fields were found by reading code; there may be more
 */
export function body(mode = 'json', fields = [], extra = {}) {
  return { mode, fields, example: NONE, partial: false, ...extra };
}

/**
 * @typedef {object} Route
 * @property {string} path      /users/{userId}
 * @property {string} method    GET, POST, ...
 * @property {string} name
 * @property {string} description
 * @property {string[]} folder
 * @property {Field[]} pathParams
 * @property {Field[]} query
 * @property {Field[]} headers
 * @property {Body|null} body
 * @property {string|null} auth  null = collection default; 'none' = public; 'refresh'
 * @property {string} source    file:line, for --verbose listings
 * @property {boolean} isLogin
 */
export function route(path, method, extra = {}) {
  return {
    path, method, name: '', description: '', folder: [], pathParams: [], query: [], headers: [],
    body: null, auth: null, csrf: false, source: '', isLogin: false, ...extra,
  };
}

export function websocket(path, description = '', source = '') {
  return { path, description, source };
}

export function api(framework) {
  return {
    framework,
    routes: [],
    websockets: [],
    auth: 'none',               // none | bearer | token | basic | apikey | session
    authHeader: 'Authorization', // header for apikey auth
    tokenPrefix: 'Token',        // 'token' auth: Authorization: <prefix> <token>
    loginPath: null,
    title: '',
    port: null,                  // port found in the code (app.listen(4000))
    warnings: [],
  };
}
