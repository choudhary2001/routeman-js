// Command line: routeman generate | routes | init
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { generate, write, resolveConfig, humanizeName } from './index.js';
import { analyze } from './analyze/index.js';
import { AUTH_TYPES, CONFIG_FILE, ConfigError, dump, load } from './config.js';
import { ProjectError, FRAMEWORK_NAMES, detectFrameworks, findEntries } from './project.js';
import { VERSION } from './version.js';

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
const paint = (text, code) => (COLOR ? `\x1b[${code}m${text}\x1b[0m` : text);
const ok = (msg) => console.log(paint('✓', '32'), msg);
const warn = (msg) => console.error(paint('!', '33'), msg);

const HELP = `routeman ${VERSION} - Postman collections from Node.js, Bun and Deno projects (Express, Fastify, NestJS, Koa, Hono,
Elysia, Hapi, Next.js, Nuxt, SvelteKit, AdonisJS and more). No OpenAPI or decorators needed; your code is never run.

Usage: routeman <command> [options]

Commands:
  generate, gen      write the Postman collection and environments (default)
  routes, ls         list the routes routeman finds
  init               create ${CONFIG_FILE} with the project details

Options:
  -C, --project DIR      project folder (default: current folder)
  -f, --framework NAME   ${FRAMEWORK_NAMES.filter((f) => f !== 'auto').join(', ')} (default: detect)
  -a, --entry FILE       entry file, e.g. src/server.ts (repeatable; default: detect)
  -n, --name NAME        collection name
  -o, --output DIR       output folder (default: postman)
  -b, --base-url URL     base URL of the "local" environment
  -e, --env NAME=URL     add an environment, e.g. -e production=https://api.example.com (repeatable)
  -x, --exclude REGEX    leave out matching paths, e.g. -x '^/internal/' (repeatable)
      --auth TYPE        force ${AUTH_TYPES.filter((a) => a !== 'auto').join(', ')}
      --login PATH       the POST route whose response contains the token
      --openapi SRC      build from an OpenAPI/Swagger file or URL instead of the source code
      --env-file FILE    .env file with values the code reads (default: .env)
      --stdout           print the collection instead of writing files
      --json             (routes) machine-readable output
  -q, --quiet            only print errors
  -y, --yes              (init) accept detected values without asking
      --force            (init) overwrite an existing ${CONFIG_FILE}
  -h, --help             show this help
  -V, --version          show the version

Examples:
  npx routeman                       # in your project folder
  routeman generate -e staging=https://staging.example.com
  routeman routes
  routeman generate --openapi http://localhost:3000/docs-json
`;

const OPTIONS = {
  project: { type: 'string', short: 'C' },
  framework: { type: 'string', short: 'f' },
  entry: { type: 'string', short: 'a', multiple: true },
  app: { type: 'string', multiple: true },
  name: { type: 'string', short: 'n' },
  output: { type: 'string', short: 'o' },
  'base-url': { type: 'string', short: 'b' },
  env: { type: 'string', short: 'e', multiple: true },
  exclude: { type: 'string', short: 'x', multiple: true },
  auth: { type: 'string' },
  login: { type: 'string' },
  openapi: { type: 'string' },
  'env-file': { type: 'string' },
  stdout: { type: 'boolean' },
  json: { type: 'boolean' },
  quiet: { type: 'boolean', short: 'q' },
  yes: { type: 'boolean', short: 'y' },
  force: { type: 'boolean' },
  verbose: { type: 'boolean', short: 'v' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'V' },
};

function envOption(list) {
  const out = {};
  for (const item of list || []) {
    const i = item.indexOf('=');
    if (i <= 0) throw new ConfigError(`--env expects NAME=URL, got '${item}'`);
    out[item.slice(0, i).trim()] = item.slice(i + 1).trim();
  }
  return out;
}

function optionsFrom(values) {
  if (values.framework && !FRAMEWORK_NAMES.includes(values.framework)) {
    throw new ConfigError(`unknown framework '${values.framework}'; use one of: ${FRAMEWORK_NAMES.join(', ')}`);
  }
  if (values.auth && !AUTH_TYPES.includes(values.auth)) throw new ConfigError(`--auth must be one of: ${AUTH_TYPES.join(', ')}`);
  return {
    project: values.project || '.',
    framework: values.framework,
    entry: [...(values.entry || []), ...(values.app || [])],
    name: values.name,
    output: values.output,
    baseUrl: values['base-url'],
    environments: envOption(values.env),
    exclude: values.exclude,
    auth: values.auth,
    login: values.login,
    openapi: values.openapi,
    envFile: values['env-file'],
  };
}

function summary(api) {
  const counts = new Map();
  for (const r of api.routes) counts.set(r.method, (counts.get(r.method) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([m, n]) => `${n} ${m}`).join(', ');
}

async function cmdGenerate(values) {
  const result = await generate(optionsFrom(values));
  const { api } = result;
  if (!api.routes.length) {
    throw new ProjectError(`no routes found in ${result.root}. Pass the entry file with --entry src/server.ts, the framework with --framework, or an OpenAPI document with --openapi.`);
  }
  if (values.stdout) {
    process.stdout.write(JSON.stringify(result.collection, null, 2) + '\n');
    for (const w of result.warnings) warn(w);
    return 0;
  }
  const files = write(result);
  if (values.quiet) return 0;
  for (const w of result.warnings) warn(w);
  ok(`${api.framework}: ${api.routes.length} requests (${summary(api)})${api.websockets.length ? `, ${api.websockets.length} websocket(s)` : ''}`);
  ok(`auth: ${api.auth}${api.loginPath ? ` (login: POST ${api.loginPath})` : ''}`);
  for (const f of files) {
    const rel = path.relative(process.cwd(), f);
    ok(`wrote ${rel && !rel.startsWith('..') ? rel : f}`);
  }
  console.log(paint(`  done in ${(result.ms / 1000).toFixed(2)}s - import the files in Postman (File → Import)`, '2'));
  return 0;
}

async function cmdRoutes(values) {
  const opts = optionsFrom(values);
  const { root, cfg } = resolveConfig(opts);
  let api;
  if (cfg.openapi) api = (await generate(opts)).api;
  else api = analyze({ root, framework: cfg.framework, entries: cfg.entry, exclude: cfg.exclude, envFile: cfg.envFile });
  if (values.json) {
    process.stdout.write(JSON.stringify(api.routes.map((r) => ({
      method: r.method, path: r.path, name: r.name, auth: r.auth === 'none' ? 'none' : api.auth, login: r.isLogin || undefined,
      body: r.body ? { mode: r.body.mode, fields: r.body.fields.map((f) => f.name) } : null, query: r.query.map((q) => q.name), source: r.source,
    })), null, 2) + '\n');
    return 0;
  }
  const width = Math.min(70, Math.max(10, ...api.routes.map((r) => r.path.length)));
  const sorted = [...api.routes].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.method.localeCompare(b.method)));
  for (const r of sorted) {
    const body = r.body ? `${r.body.mode}${r.body.fields.length ? ': ' + r.body.fields.map((f) => f.name).join(', ') : ''}` : '';
    const lock = r.auth === 'none' || api.auth === 'none' ? ' ' : '🔒';
    console.log(`${r.method.padEnd(7)} ${r.path.padEnd(width)}  ${lock} ${paint(body, '2')}${values.verbose && r.source ? paint('  ' + r.source, '2') : ''}`);
  }
  console.log(paint(`${api.routes.length} routes, auth: ${api.auth}${api.loginPath ? ` (login: POST ${api.loginPath})` : ''}`, '2'));
  for (const w of api.warnings) warn(w);
  return 0;
}

async function ask(rl, question, def = '', choices = null) {
  for (;;) {
    let answer = '';
    try {
      answer = (await rl.question(`${question}${def ? ` [${def}]` : ''}: `)).trim();
    } catch {
      answer = '';
    }
    answer = answer || def;
    if (!choices || choices.includes(answer)) return answer;
    console.log(`  choose one of: ${choices.join(', ')}`);
  }
}

async function cmdInit(values) {
  const root = path.resolve(values.project || '.');
  const target = path.join(root, CONFIG_FILE);
  if (fs.existsSync(target) && !values.force) throw new ProjectError(`${CONFIG_FILE} already exists (use --force to overwrite)`);
  const cfg = load(root);
  const detected = detectFrameworks(root);
  cfg.framework = values.framework || detected[0] || 'auto';
  cfg.name = values.name || resolveConfig({ project: root }).cfg.name || humanizeName(path.basename(root));
  const entries = findEntries(root).map((f) => path.relative(root, f));
  cfg.entry = values.entry || [];
  let local = values['base-url'] || 'http://localhost:3000';
  try {
    const api = analyze({ root, framework: cfg.framework });
    local = values['base-url'] || `http://localhost:${api.port || 3000}`;
  } catch { /* keep default */ }
  let production = '';
  if (!values.yes && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log(paint('routeman init', '1') + ' - press Enter to accept the value in brackets\n');
    cfg.name = await ask(rl, 'Collection name', cfg.name);
    cfg.framework = await ask(rl, 'Framework', cfg.framework, FRAMEWORK_NAMES);
    const e = await ask(rl, 'Entry file (optional, detected)', entries[0] || '');
    if (e && e !== entries[0]) cfg.entry = [e];
    local = await ask(rl, 'Local base URL', local);
    production = await ask(rl, 'Production base URL (optional)', '');
    cfg.auth = await ask(rl, `Auth (${AUTH_TYPES.join('/')})`, 'auto', AUTH_TYPES);
    cfg.login = await ask(rl, 'Login path that returns a token (optional, detected)', '');
    cfg.output = await ask(rl, 'Output folder', cfg.output);
    rl.close();
  }
  cfg.environments = { local };
  if (production) cfg.environments.production = production;
  Object.assign(cfg.environments, envOption(values.env));
  fs.writeFileSync(target, dump(cfg));
  ok(`wrote ${CONFIG_FILE} (${cfg.framework})`);
  console.log('  next: ' + paint('routeman generate', '1'));
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    console.error(paint('error:', '31'), err.message);
    console.error('  run `routeman --help` for usage');
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.version) {
    console.log(`routeman ${VERSION}`);
    return 0;
  }
  const command = positionals[0] || (values.help ? 'help' : 'generate');
  try {
    switch (command) {
      case 'generate': case 'gen': return values.help ? (console.log(HELP), 0) : await cmdGenerate(values);
      case 'routes': case 'ls': return await cmdRoutes(values);
      case 'init': return await cmdInit(values);
      case 'help': console.log(HELP); return 0;
      default:
        console.error(paint('error:', '31'), `unknown command '${command}'`);
        console.error('  run `routeman --help` for usage');
        return 2;
    }
  } catch (err) {
    if (err instanceof ProjectError || err instanceof ConfigError) {
      console.error(paint('error:', '31'), err.message);
      return 2;
    }
    if (process.env.ROUTEMAN_DEBUG) throw err;
    console.error(paint('error:', '31'), `routeman failed: ${err && err.name}: ${err && err.message}`);
    console.error('  rerun with ROUTEMAN_DEBUG=1 for the stack trace, and please report it at https://github.com/choudhary2001/routeman-js/issues');
    return 1;
  }
}
