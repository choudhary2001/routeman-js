// Compare routeman's analysis of a test project with its hand-written expected.json.
import fs from 'node:fs';
import path from 'node:path';
import { analyze } from '../src/analyze/index.js';

export function compare(dir) {
  const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
  const api = analyze({ root: dir, framework: 'auto' });
  const problems = [];
  const key = (m, p) => `${m} ${p}`;
  const got = new Map(api.routes.map((r) => [key(r.method, r.path), r]));
  for (const e of expected) {
    const r = got.get(key(e.method, e.path));
    if (!r) { problems.push(`missing ${key(e.method, e.path)}`); continue; }
    got.delete(key(e.method, e.path));
    const isAuth = api.auth !== 'none' && r.auth !== 'none';
    if (!!e.auth !== isAuth) problems.push(`${key(e.method, e.path)}: auth expected ${!!e.auth}, got ${isAuth}`);
    const body = r.body ? r.body.fields.map((f) => f.name) : null;
    const eb = e.body || null;
    if (eb && eb.length) {
      const miss = eb.filter((n) => !(body || []).includes(n));
      if (miss.length) problems.push(`${key(e.method, e.path)}: body missing ${miss.join(', ')} (got ${body ? body.join(', ') : 'no body'})`);
      const extra = (body || []).filter((n) => !eb.includes(n));
      if (extra.length) problems.push(`${key(e.method, e.path)}: body has extra ${extra.join(', ')}`);
    } else if (body && body.length) problems.push(`${key(e.method, e.path)}: unexpected body ${body.join(', ')}`);
    const q = r.query.map((f) => f.name);
    const missQ = (e.query || []).filter((n) => !q.includes(n));
    if (missQ.length) problems.push(`${key(e.method, e.path)}: query missing ${missQ.join(', ')}`);
    const extraQ = q.filter((n) => !(e.query || []).includes(n));
    if (extraQ.length) problems.push(`${key(e.method, e.path)}: query has extra ${extraQ.join(', ')}`);
    if (e.login && !r.isLogin && api.loginPath !== r.path) problems.push(`${key(e.method, e.path)}: not detected as login`);
  }
  for (const k of got.keys()) problems.push(`unexpected route ${k}`);
  return { api, problems };
}

if (process.argv[2]) {
  const { api, problems } = compare(path.resolve(process.argv[2]));
  console.log(`${api.framework}: ${api.routes.length} routes, auth ${api.auth}, ${problems.length} problem(s)`);
  for (const p of problems) console.log('  -', p);
  for (const w of api.warnings) console.log('  warning:', w);
}
