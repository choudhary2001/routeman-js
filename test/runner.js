// A small Postman collection runner for the tests: sends each request the way Postman would
// (variables, inherited auth, raw/urlencoded/form-data bodies, the login script), so a generated
// collection can be checked against a real running server.
const VAR = /\{\{(\w+)\}\}/g;
const TOKEN_KEYS = ['access_token', 'accessToken', 'access', 'token', 'jwt', 'id_token', 'idToken', 'key', 'auth_token', 'authToken'];
const REFRESH_KEYS = ['refresh_token', 'refreshToken', 'refresh'];

function find(obj, keys, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return undefined;
  for (const k of keys) if (typeof obj[k] === 'string' && obj[k]) return obj[k];
  for (const v of Object.values(obj)) {
    const r = find(v, keys, depth + 1);
    if (r) return r;
  }
  return undefined;
}

export class Runner {
  constructor(collection, environment, overrides = {}) {
    this.collection = collection;
    this.vars = {};
    for (const v of collection.variable || []) this.vars[v.key] = v.value || '';
    for (const v of environment.values) if (v.enabled !== false) this.vars[v.key] = v.value;
    Object.assign(this.vars, overrides);
  }

  sub(text) {
    let out = String(text);
    for (let i = 0; i < 3; i++) out = out.replace(VAR, (m, k) => (k in this.vars ? String(this.vars[k]) : m));
    return out;
  }

  *items(items = this.collection.item, auth = this.collection.auth) {
    for (const item of items) {
      if (item.item) yield* this.items(item.item, item.auth || auth);
      else yield { item, auth: item.request.auth || auth };
    }
  }

  async send(item, auth) {
    const req = item.request;
    const url = this.sub(req.url.raw);
    const headers = {};
    for (const h of req.header || []) if (!h.disabled) headers[h.key] = this.sub(h.value);
    if (auth && auth.type !== 'noauth') {
      const values = Object.fromEntries(auth[auth.type].map((e) => [e.key, this.sub(e.value)]));
      if (auth.type === 'bearer' && values.token) headers.Authorization = `Bearer ${values.token}`;
      else if (auth.type === 'apikey') headers[values.key] = values.value;
      else if (auth.type === 'basic') headers.Authorization = 'Basic ' + Buffer.from(`${values.username}:${values.password}`).toString('base64');
    }
    let body;
    if (req.body) {
      const b = req.body;
      if (b.mode === 'raw') body = this.sub(b.raw);
      else if (b.mode === 'urlencoded') {
        body = new URLSearchParams();
        for (const e of b.urlencoded) if (!e.disabled) body.append(e.key, this.sub(e.value));
      } else if (b.mode === 'formdata') {
        body = new FormData();
        delete headers['Content-Type'];
        for (const e of b.formdata) {
          if (e.disabled) continue;
          if (e.type === 'file') body.append(e.key, new Blob([Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32, 48)])], { type: 'image/png' }), 'sample.png');
          else body.append(e.key, this.sub(e.value));
        }
      }
    }
    const res = await fetch(url, { method: req.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    if (item.event) {
      const access = find(json, TOKEN_KEYS);
      const refresh = find(json, REFRESH_KEYS);
      if (access) this.vars.access_token = access;
      if (refresh) this.vars.refresh_token = refresh;
    }
    return { status: res.status, text, json };
  }
}
