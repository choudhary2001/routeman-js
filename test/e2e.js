// End to end: generate the collection for each runnable test project, start the real server,
// replay every request and check the generated requests are accepted by the application.
//
//   node test/e2e.js [project ...]
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../src/index.js';
import { Runner } from './runner.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS = path.join(HERE, 'projects');
const BIN = path.join(PROJECTS, 'node_modules', '.bin');
const ADMIN = { username: 'admin@example.com', password: 'Str0ngPassw0rd!', api_key: 'test-api-key' };

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function waitFor(port, proc, log, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (proc.exitCode !== null) throw new Error(`server exited (${proc.exitCode}):\n${log.join('')}`);
    const ok = await new Promise((resolve) => {
      const sock = net.connect(port, '127.0.0.1', () => { sock.end(); resolve(true); });
      sock.on('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server did not start:\n${log.join('')}`);
}

/** How to start a project: [command, args] */
function startCommand(dir) {
  if (fs.existsSync(path.join(dir, 'deno.json'))) return ['deno', ['task', 'start']];
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const start = (pkg.scripts && pkg.scripts.start) || 'node index.js';
  if (fs.existsSync(path.join(dir, 'tsconfig.build.json'))) {
    execFileSync(path.join(BIN, 'tsc'), ['-p', 'tsconfig.build.json'], { cwd: dir, stdio: 'inherit' });
  }
  const [cmd, ...args] = start.split(/\s+/);
  if (cmd === 'tsx') return [path.join(BIN, 'tsx'), args];
  if (cmd === 'bun') return ['bun', args];
  return [cmd, args];
}

export async function runProject(name) {
  const dir = path.join(PROJECTS, name);
  const port = await freePort();
  const result = await generate({ project: dir, baseUrl: `http://127.0.0.1:${port}`, output: path.join('/tmp', 'routeman-e2e', name) });
  const [cmd, args] = startCommand(dir);
  const log = [];
  const proc = spawn(cmd, args, { cwd: dir, env: { ...process.env, PORT: String(port), NODE_ENV: 'development' }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => log.push(String(d)));
  proc.stderr.on('data', (d) => log.push(String(d)));
  const failures = [];
  let sent = 0;
  try {
    await waitFor(port, proc, log);
    const env = result.environments[0].data;
    const runner = new Runner(result.collection, env, ADMIN);
    const all = [...runner.items()];
    // login first, like a user would
    // login first (like a user would), deletes last (so seeded records stay available)
    const rank = (x) => (x.item.event ? 0 : x.item.request.method === 'DELETE' ? 2 : 1);
    all.sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? b.item.request.url.raw.length - a.item.request.url.raw.length : 0));
    for (const { item, auth } of all) {
      const req = item.request;
      const label = `${req.method} ${req.url.raw.replace('{{base_url}}', '').split('?')[0]}`;
      let res;
      try {
        res = await runner.send(item, auth);
      } catch (err) {
        failures.push(`${label}: ${err.message}`);
        continue;
      }
      sent++;
      const s = res.status;
      const why = s >= 500 ? 'server error' : s === 404 ? 'not found (route missing?)' : s === 400 || s === 422 ? 'rejected the generated body/query'
        : (s === 401 || s === 403) && auth && auth.type !== 'noauth' ? 'auth failed' : s === 405 ? 'method not allowed' : null;
      if (why) failures.push(`${label} -> ${s} ${why}: ${res.text.slice(0, 200)}`);
      if (item.event && !runner.vars.access_token) failures.push(`${label}: login did not return a token: ${res.text.slice(0, 200)}`);
    }
  } finally {
    proc.kill('SIGTERM');
  }
  return { name, sent, failures, routes: result.api.routes.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const names = process.argv.slice(2);
  let bad = 0;
  for (const name of names) {
    try {
      const r = await runProject(name);
      console.log(`${r.failures.length ? '✗' : '✓'} ${name}: ${r.sent}/${r.routes} requests sent, ${r.failures.length} failure(s)`);
      for (const f of r.failures) console.log('   -', f);
      if (r.failures.length) bad++;
    } catch (err) {
      bad++;
      console.log(`✗ ${name}: ${err.message.slice(0, 2000)}`);
    }
  }
  process.exitCode = bad ? 1 : 0;
}
