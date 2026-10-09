// routeman.config.json, or a "routeman" key in package.json.
import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './analyze/resolve.js';

export const CONFIG_FILE = 'routeman.config.json';
export const AUTH_TYPES = ['auto', 'none', 'bearer', 'token', 'basic', 'apikey', 'header', 'session'];

/**
 * @typedef {object} Config
 * @property {string} name
 * @property {string} framework      'auto' or a framework id
 * @property {string[]} entry         entry files
 * @property {string} output
 * @property {Record<string,string>} environments
 * @property {string[]} exclude
 * @property {string} auth
 * @property {string} authHeader
 * @property {string} tokenPrefix
 * @property {string} login
 * @property {string} envFile
 * @property {string} openapi
 * @property {string|null} source
 */

/** @returns {Config} */
export function defaults() {
  return { name: '', framework: 'auto', entry: [], output: 'postman', environments: {}, exclude: [], auth: 'auto', authHeader: '', tokenPrefix: '', login: '', envFile: '', openapi: '', source: null };
}

export class ConfigError extends Error {}

function str(v, key) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new ConfigError(`"${key}" must be a string`);
  return v;
}

function list(v, key) {
  if (v === undefined || v === null) return [];
  if (typeof v === 'string') return [v];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new ConfigError(`"${key}" must be a list of strings`);
  return v;
}

export function load(root) {
  const cfg = defaults();
  let data = null;
  const file = path.join(root, CONFIG_FILE);
  if (fs.existsSync(file)) {
    data = readJson(file);
    if (!data) throw new ConfigError(`${CONFIG_FILE} is not valid JSON`);
    cfg.source = file;
  } else {
    const pkg = readJson(path.join(root, 'package.json'));
    if (pkg && pkg.routeman && typeof pkg.routeman === 'object') {
      data = pkg.routeman;
      cfg.source = path.join(root, 'package.json');
    }
  }
  if (!data) return cfg;
  let auth = data.auth || {};
  if (typeof auth === 'string') auth = { type: auth };
  cfg.name = str(data.name, 'name');
  cfg.framework = (str(data.framework, 'framework') || 'auto').toLowerCase();
  cfg.entry = list(data.entry, 'entry');
  cfg.output = str(data.output, 'output') || 'postman';
  if (data.environments) {
    if (typeof data.environments !== 'object' || Array.isArray(data.environments)) throw new ConfigError('"environments" must be an object of name: url');
    cfg.environments = Object.fromEntries(Object.entries(data.environments).map(([k, v]) => [k, String(v)]));
  }
  cfg.exclude = list(data.exclude, 'exclude');
  cfg.auth = (str(auth.type, 'auth.type') || 'auto').toLowerCase();
  if (!AUTH_TYPES.includes(cfg.auth)) throw new ConfigError(`"auth.type" must be one of ${AUTH_TYPES.join(', ')}`);
  cfg.authHeader = str(auth.header, 'auth.header');
  cfg.tokenPrefix = str(auth.prefix, 'auth.prefix');
  cfg.login = str(auth.login, 'auth.login');
  cfg.envFile = str(data.envFile, 'envFile');
  cfg.openapi = str(data.openapi, 'openapi');
  return cfg;
}

export function dump(cfg) {
  const out = {
    $schema: 'https://unpkg.com/routeman-cli/schema.json',
    name: cfg.name,
    framework: cfg.framework || 'auto',
    ...(cfg.entry && cfg.entry.length ? { entry: cfg.entry } : {}),
    output: cfg.output || 'postman',
    environments: Object.keys(cfg.environments || {}).length ? cfg.environments : { local: 'http://localhost:3000' },
    exclude: cfg.exclude || [],
    auth: {
      type: cfg.auth || 'auto',
      ...(cfg.login ? { login: cfg.login } : {}),
      ...(cfg.tokenPrefix ? { prefix: cfg.tokenPrefix } : {}),
      ...(cfg.authHeader ? { header: cfg.authHeader } : {}),
    },
    ...(cfg.envFile ? { envFile: cfg.envFile } : {}),
  };
  return JSON.stringify(out, null, 2) + '\n';
}
