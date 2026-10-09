// Project discovery: frameworks in use, entry files, .env values, source file listing.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, SOURCE_EXTS } from './analyze/resolve.js';

export class ProjectError extends Error {}

/** Framework ids routeman understands, with the packages that identify them. */
export const FRAMEWORKS = {
  nest: ['@nestjs/core', '@nestjs/common'],
  next: ['next'],
  nuxt: ['nuxt', 'nuxt3'],
  nitro: ['nitropack', 'nitro'],
  sveltekit: ['@sveltejs/kit'],
  astro: ['astro'],
  remix: ['@remix-run/node', '@remix-run/server-runtime', '@react-router/node', '@react-router/dev'],
  adonis: ['@adonisjs/core'],
  'routing-controllers': ['routing-controllers'],
  tsoa: ['tsoa', '@tsoa/runtime'],
  inversify: ['inversify-express-utils'],
  loopback: ['@loopback/rest', '@loopback/core'],
  feathers: ['@feathersjs/feathers'],
  fastify: ['fastify'],
  hono: ['hono'],
  elysia: ['elysia'],
  koa: ['koa', '@koa/router', 'koa-router'],
  hapi: ['@hapi/hapi', 'hapi'],
  restify: ['restify'],
  oak: ['@oakserver/oak', 'oak', '@oak/oak'],
  h3: ['h3'],
  polka: ['polka'],
  tinyhttp: ['@tinyhttp/app'],
  'hyper-express': ['hyper-express'],
  'ultimate-express': ['ultimate-express'],
  itty: ['itty-router'],
  express: ['express'],
};

const ORDER = Object.keys(FRAMEWORKS);
export const FRAMEWORK_NAMES = ['auto', ...ORDER, 'bun', 'deno', 'node', 'openapi'];
export const FILE_ROUTED = new Set(['next', 'nuxt', 'nitro', 'sveltekit', 'astro', 'remix']);
export const DECORATED = new Set(['nest', 'routing-controllers', 'tsoa', 'inversify', 'loopback']);

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.output', '.svelte-kit', '.astro',
  'coverage', '.turbo', '.vercel', '.netlify', '.cache', 'tmp', '.idea', '.vscode', '__tests__', '__mocks__', 'test', 'tests',
  'e2e', 'cypress', 'playwright', 'storybook-static', 'public', 'static', 'docs', 'examples', 'fixtures', 'migrations', 'seeders', 'seeds', 'logs']);

export function packageInfo(root) {
  const pkg = readJson(path.join(root, 'package.json')) || {};
  const deps = { ...(pkg.peerDependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.dependencies || {}) };
  // Deno: imports in deno.json(c)
  for (const name of ['deno.json', 'deno.jsonc']) {
    const d = readJson(path.join(root, name));
    if (d && d.imports) {
      for (const spec of Object.values(d.imports)) {
        const m = /^(?:npm:|jsr:)?(@?[^@]+?)(?:@[^/]*)?$/.exec(String(spec));
        if (m) deps[m[1].replace(/^https?:\/\/deno\.land\/x\//, '').split('/')[0]] = '*';
      }
      pkg.__deno = true;
    }
  }
  return { pkg, deps };
}

/** Frameworks detected from dependencies, most specific first. */
export function detectFrameworks(root) {
  const { deps, pkg } = packageInfo(root);
  const found = [];
  for (const id of ORDER) if (FRAMEWORKS[id].some((p) => deps[p])) found.push(id);
  if (found.includes('nuxt')) return ['nuxt', ...found.filter((f) => f !== 'nuxt' && f !== 'nitro' && f !== 'h3')];
  if (!found.length) {
    if (pkg.__deno || fs.existsSync(path.join(root, 'deno.json'))) found.push('deno');
    else if (fs.existsSync(path.join(root, 'bunfig.toml')) || deps['@types/bun'] || deps['bun-types']) found.push('bun');
  }
  return found;
}

export function loadEnvFile(file, env) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let value = m[2];
    if (/^(['"`])[\s\S]*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    if (!env.has(m[1])) env.set(m[1], value);
  }
  return true;
}

/** Files named in package.json scripts: "node src/server.js", "tsx watch src/main.ts", "bun run index.ts". */
function scriptEntries(root, pkg) {
  const out = [];
  const scripts = pkg.scripts || {};
  const order = ['start', 'dev', 'serve', 'start:dev', 'start:prod', 'server', 'develop', 'watch', 'prod'];
  const names = [...order.filter((n) => scripts[n]), ...Object.keys(scripts).filter((n) => !order.includes(n) && /start|dev|serve/.test(n))];
  for (const name of names) {
    const cmd = String(scripts[name]);
    for (const token of cmd.split(/[\s;&|]+/)) {
      const t = token.replace(/^['"]|['"]$/g, '');
      if (/\.(c|m)?[jt]sx?$/.test(t) && !t.startsWith('-') && !/config\.|\.config\./.test(t)) {
        out.push(t);
      }
    }
  }
  return out;
}

function mapBuildToSource(root, file) {
  // dist/server.js -> src/server.ts
  const rel = path.relative(root, file);
  const m = /^(dist|build|lib|out)\/(.*)\.(c|m)?js$/.exec(rel.split(path.sep).join('/'));
  if (!m) return null;
  for (const dir of ['src', '']) {
    for (const ext of ['.ts', '.mts', '.js', '.mjs', '.cts', '.cjs']) {
      const cand = path.join(root, dir, m[2].replace(/^src\//, '') + ext);
      if (fs.existsSync(cand)) return cand;
    }
  }
  return null;
}

/** Likely entry files, best first. */
export function findEntries(root) {
  const { pkg } = packageInfo(root);
  const cands = [];
  const add = (p) => {
    if (!p) return;
    const abs = path.resolve(root, p);
    let file = null;
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) file = abs;
    else {
      for (const ext of SOURCE_EXTS) if (fs.existsSync(abs + ext)) { file = abs + ext; break; }
      if (!file) for (const ext of SOURCE_EXTS) if (fs.existsSync(path.join(abs, 'index' + ext))) { file = path.join(abs, 'index' + ext); break; }
    }
    if (file && /\.(c|m)?js$/.test(file) && /(^|\/)(dist|build|lib|out)\//.test(path.relative(root, file))) file = mapBuildToSource(root, file) || null;
    if (!file && /(^|\/)(dist|build|out)\//.test(p)) file = mapBuildToSource(root, abs);
    if (file && SOURCE_EXTS.includes(path.extname(file)) && !cands.includes(file)) cands.push(file);
  };
  for (const s of scriptEntries(root, pkg)) add(s);
  if (typeof pkg.main === 'string') add(pkg.main);
  if (pkg.module) add(pkg.module);
  // wrangler.toml main = "src/index.ts"
  try {
    const w = fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8');
    const m = /^\s*main\s*=\s*["']([^"']+)["']/m.exec(w);
    if (m) add(m[1]);
  } catch { /* none */ }
  for (const name of ['src/main', 'src/server', 'src/index', 'src/app', 'server', 'index', 'app', 'main', 'src/api/index', 'api/index',
    'src/http/server', 'src/infra/http/server', 'src/bin/www', 'bin/www', 'start/routes', 'mod']) add(name);
  return cands;
}

/** All source files of the project (excluding tests, builds and dependencies). */
export function listSources(root, limit = 5000) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 12 || out.length >= limit) return;
    let names;
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of names) {
      if (d.name.startsWith('.') && d.name !== '.') continue;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        if (IGNORED_DIRS.has(d.name)) continue;
        walk(full, depth + 1);
      } else if (SOURCE_EXTS.includes(path.extname(d.name)) && !/\.(test|spec|e2e-spec|stories|d)\.[cm]?[jt]sx?$/.test(d.name) && !/\.d\.[cm]?ts$/.test(d.name)) {
        out.push(full);
      }
    }
  };
  walk(root, 0);
  return out;
}

export function loadEnv(root, envFile) {
  const env = new Map();
  if (envFile) {
    const file = path.resolve(root, envFile);
    if (!loadEnvFile(file, env)) throw new ProjectError(`env file not found: ${file}`);
  }
  // real values first; the committed example file fills in what is missing (route prefixes, ports)
  for (const name of ['.env.local', '.env.development.local', '.env.development', '.env', '.env.example', '.env.sample', '.env.defaults', '.env.dist']) {
    loadEnvFile(path.join(root, name), env);
  }
  if (!env.has('NODE_ENV')) env.set('NODE_ENV', 'development');
  return env;
}
