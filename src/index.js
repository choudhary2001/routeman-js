// Programmatic API.
//
//   import { generate } from 'routeman-cli';
//   const { collection, environments, api } = await generate({ project: '.' });
import fs from 'node:fs';
import path from 'node:path';
import { analyze } from './analyze/index.js';
import { fromOpenapi } from './openapi.js';
import { Writer } from './postman.js';
import { load as loadConfig, ConfigError } from './config.js';
import { ProjectError } from './project.js';
import { parseYaml } from './yaml.js';
import { VERSION } from './version.js';

const DEFAULT_PORTS_NOTE = 3000;

export function humanizeName(text) {
  const words = String(text).split(/[-_\s]+/).filter(Boolean);
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') + ' API';
}

export function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'api';
}

/** Read an OpenAPI / Swagger document from a file path or http(s) URL. */
export async function readSpec(source, root = '.') {
  let text;
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source, { headers: { accept: 'application/json, application/yaml;q=0.9, */*;q=0.5' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new ProjectError(`could not download ${source}: HTTP ${res.status}`);
    text = await res.text();
  } else {
    const file = path.resolve(root, source);
    if (!fs.existsSync(file)) throw new ProjectError(`OpenAPI file not found: ${file}`);
    text = fs.readFileSync(file, 'utf8');
  }
  try {
    return /^\s*[{[]/.test(text) ? JSON.parse(text) : parseYaml(text);
  } catch (err) {
    throw new ProjectError(`could not read the OpenAPI document ${source}: ${err.message}`);
  }
}

/**
 * Resolve configuration: routeman.config.json / package.json "routeman", then explicit options.
 * @param {object} options  { project, framework, entry, name, output, baseUrl, environments, exclude, auth, login, envFile, openapi }
 */
export function resolveConfig(options = {}) {
  const root = path.resolve(options.project || '.');
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new ProjectError(`project folder not found: ${root}`);
  const cfg = loadConfig(root);
  const configuredEnvs = Object.keys(cfg.environments).length > 0;
  if (options.framework) cfg.framework = options.framework;
  if (options.entry && options.entry.length) cfg.entry = [].concat(options.entry);
  if (options.name) cfg.name = options.name;
  if (options.output) cfg.output = options.output;
  if (options.exclude) cfg.exclude = [...cfg.exclude, ...[].concat(options.exclude)];
  if (options.auth) cfg.auth = options.auth;
  if (options.login) cfg.login = options.login;
  if (options.envFile) cfg.envFile = options.envFile;
  if (options.openapi) cfg.openapi = options.openapi;
  if (options.authHeader) cfg.authHeader = options.authHeader;
  if (options.tokenPrefix) cfg.tokenPrefix = options.tokenPrefix;
  for (const [k, v] of Object.entries(options.environments || {})) cfg.environments[k] = v;
  if (options.baseUrl) cfg.environments = { local: options.baseUrl, ...Object.fromEntries(Object.entries(cfg.environments).filter(([k]) => k !== 'local')) };
  if (!cfg.name) {
    let pkgName = '';
    try { pkgName = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name || ''; } catch { /* none */ }
    cfg.name = humanizeName(String(pkgName || path.basename(root)).replace(/^@[^/]+\//, '').replace(/[-_]?api$/i, ''));
  }
  for (const re of cfg.exclude) {
    try { new RegExp(re); } catch { throw new ConfigError(`invalid exclude pattern: ${re}`); }
  }
  return { root, cfg, configuredEnvs };
}

function applyAuth(api, cfg, warn) {
  if (cfg.auth && cfg.auth !== 'auto') {
    api.auth = cfg.auth;
    if (cfg.auth === 'none') for (const r of api.routes) r.auth = null;
  }
  if (cfg.tokenPrefix) {
    api.tokenPrefix = cfg.tokenPrefix;
    if (api.auth === 'bearer' && cfg.tokenPrefix !== 'Bearer') api.auth = 'token';
  }
  if (cfg.authHeader) api.authHeader = cfg.authHeader;
  if (cfg.login) {
    const target = '/' + cfg.login.replace(/^\/+|\/+$/g, '');
    const match = api.routes.filter((r) => r.method === 'POST' && r.path.replace(/\/+$/, '') === target);
    if (!match.length) warn(`login path ${cfg.login} is not a POST route of this project`);
    else {
      for (const r of api.routes) r.isLogin = false;
      for (const r of match) { r.isLogin = true; r.auth = 'none'; api.loginPath = r.path; }
    }
  }
}

/**
 * Analyse a project (or an OpenAPI document) and build the Postman collection and environments.
 * Never runs the project's code.
 */
export async function generate(options = {}) {
  const started = Date.now();
  const { root, cfg, configuredEnvs } = resolveConfig(options);
  const warnings = [];
  const warn = (m) => warnings.push(m);
  let api;
  if (cfg.openapi) {
    api = fromOpenapi(await readSpec(cfg.openapi, root));
    if (!options.name && api.title && !loadConfig(root).name) cfg.name = api.title;
  } else {
    api = analyze({ root, framework: cfg.framework, entries: cfg.entry, exclude: cfg.exclude, envFile: cfg.envFile, log: warn });
  }
  applyAuth(api, cfg, warn);
  warnings.push(...api.warnings);
  if (!configuredEnvs && !cfg.environments.local) {
    cfg.environments = { local: `http://localhost:${api.port || DEFAULT_PORTS_NOTE}`, ...cfg.environments };
  }
  const envs = Object.entries(cfg.environments);
  const writer = new Writer(api, cfg.name, envs[0][1]);
  const collection = writer.collection();
  const environments = envs.map(([name, url]) => ({ name, file: `${slug(cfg.name)}.${slug(name)}.postman_environment.json`, data: writer.environment(name, url) }));
  return { api, collection, environments, config: cfg, root, warnings: [...new Set(warnings)], ms: Date.now() - started, version: VERSION };
}

/** Write the collection and environments to the output folder. Returns the written file paths. */
export function write(result) {
  const out = path.resolve(result.root, result.config.output);
  fs.mkdirSync(out, { recursive: true });
  const files = [];
  const base = slug(result.config.name);
  const col = path.join(out, `${base}.postman_collection.json`);
  fs.writeFileSync(col, JSON.stringify(result.collection, null, 2) + '\n');
  files.push(col);
  for (const e of result.environments) {
    const f = path.join(out, e.file);
    fs.writeFileSync(f, JSON.stringify(e.data, null, 2) + '\n');
    files.push(f);
  }
  return files;
}

export { analyze, fromOpenapi, Writer, VERSION, ProjectError, ConfigError };
