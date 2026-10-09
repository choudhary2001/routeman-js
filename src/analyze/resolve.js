// Module resolution: relative files, tsconfig paths/baseUrl, package.json "imports", Deno/JSR specifiers.
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';

export const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const BUILTINS = new Set(builtinModules);
const SWAP = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };

/** Parse JSON with comments and trailing commas (tsconfig.json, jsconfig.json, deno.json). */
export function parseJsonc(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

export function readJson(file) {
  try {
    return parseJsonc(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Normalise a bare specifier to a package name + subpath ("npm:express@5" -> "express"). */
export function packageSpec(spec) {
  let s = spec;
  if (s.startsWith('node:')) return s.slice(5);
  if (s.startsWith('npm:') || s.startsWith('jsr:')) s = s.slice(4).replace(/^\//, '');
  const deno = /^https?:\/\/deno\.land\/(?:x\/)?([\w.-]+?)(?:@[^/]+)?(\/.*)?$/.exec(s);
  if (deno) return deno[1] === 'std' ? 'deno-std' + (deno[2] || '') : deno[1];
  const esm = /^https?:\/\/(?:esm\.sh|cdn\.skypack\.dev|unpkg\.com|cdn\.jsdelivr\.net\/npm)\/((?:@[\w.-]+\/)?[\w.-]+?)(?:@[^/]+)?(\/.*)?$/.exec(s);
  if (esm) return esm[1] + (esm[2] && !/\.(m?js|ts)$/.test(esm[2]) ? esm[2] : '');
  // drop a version: express@5, @scope/pkg@1.2/sub
  const m = /^(@[^/@]+\/[^/@]+|[^/@]+)(?:@[^/]*)?(\/.*)?$/.exec(s);
  return m ? m[1] + (m[2] || '') : s;
}

export class Resolver {
  constructor(root) {
    this.root = root;
    this.cache = new Map();
    this.exists = new Map();
    this.pkg = readJson(path.join(root, 'package.json')) || {};
    this.aliases = [];   // [{ prefix, suffix, targets: [abs paths with '*'] }]
    this.baseUrl = null;
    this.loadTsconfig(path.join(root, 'tsconfig.json'), 0);
    if (!this.aliases.length) this.loadTsconfig(path.join(root, 'jsconfig.json'), 0);
    this.loadImportsField();
    this.loadDenoImports();
    // Common framework aliases that are not always declared (Nuxt, Vite, SvelteKit).
    for (const [prefix, dir] of [['~~/', '.'], ['@@/', '.'], ['~/', 'src'], ['~/', '.'], ['@/', 'src'], ['@/', '.'], ['$lib/', 'src/lib'], ['#server/', 'server']]) {
      this.aliases.push({ prefix, suffix: '', targets: [path.join(root, dir, '*')], fallback: true });
    }
  }

  isFile(p) {
    let v = this.exists.get(p);
    if (v === undefined) {
      try {
        v = fs.statSync(p).isFile();
      } catch {
        v = false;
      }
      this.exists.set(p, v);
    }
    return v;
  }

  loadTsconfig(file, depth) {
    if (depth > 5) return;
    const cfg = readJson(file);
    if (!cfg) return;
    const dir = path.dirname(file);
    if (cfg.extends) {
      for (const ext of [].concat(cfg.extends)) {
        if (typeof ext === 'string' && ext.startsWith('.')) {
          const target = path.resolve(dir, ext);
          this.loadTsconfig(target.endsWith('.json') ? target : target + '.json', depth + 1);
        }
      }
    }
    const opts = cfg.compilerOptions || {};
    if (opts.baseUrl) this.baseUrl = path.resolve(dir, opts.baseUrl);
    if (opts.paths) {
      const base = opts.baseUrl ? path.resolve(dir, opts.baseUrl) : dir;
      for (const [pattern, targets] of Object.entries(opts.paths)) {
        const star = pattern.indexOf('*');
        this.aliases.unshift({
          prefix: star < 0 ? pattern : pattern.slice(0, star),
          suffix: star < 0 ? '' : pattern.slice(star + 1),
          exact: star < 0,
          targets: [].concat(targets).map((t) => path.resolve(base, t)),
        });
      }
    }
  }

  loadImportsField() {
    const imports = this.pkg.imports;
    if (!imports || typeof imports !== 'object') return;
    for (const [pattern, target] of Object.entries(imports)) {
      let t = target;
      if (t && typeof t === 'object') t = t.types || t.import || t.node || t.default || t.require || Object.values(t)[0];
      if (typeof t !== 'string') continue;
      const star = pattern.indexOf('*');
      this.aliases.unshift({
        prefix: star < 0 ? pattern : pattern.slice(0, star),
        suffix: star < 0 ? '' : pattern.slice(star + 1),
        exact: star < 0,
        targets: [path.resolve(this.root, t)],
      });
    }
  }

  loadDenoImports() {
    for (const name of ['deno.json', 'deno.jsonc', 'import_map.json']) {
      const cfg = readJson(path.join(this.root, name));
      if (cfg && cfg.imports) {
        this.denoImports = cfg.imports;
        return;
      }
    }
  }

  probe(base) {
    if (this.isFile(base) && SOURCE_EXTS.includes(path.extname(base))) return base;
    const ext = path.extname(base);
    if (SWAP[ext]) {
      const stem = base.slice(0, -ext.length);
      for (const e of SWAP[ext]) if (this.isFile(stem + e)) return stem + e;
    }
    for (const e of SOURCE_EXTS) if (this.isFile(base + e)) return base + e;
    for (const e of SOURCE_EXTS) {
      const idx = path.join(base, 'index' + e);
      if (this.isFile(idx)) return idx;
    }
    if (this.isFile(base) && /\.json$/.test(base)) return base;
    return null;
  }

  /**
   * @returns {{file: string}|{pkg: string}|null}
   */
  resolve(spec, fromFile) {
    const key = spec + '\0' + path.dirname(fromFile);
    if (this.cache.has(key)) return this.cache.get(key);
    const out = this.resolveUncached(spec, fromFile);
    this.cache.set(key, out);
    return out;
  }

  resolveUncached(spec, fromFile) {
    if (typeof spec !== 'string' || !spec) return null;
    if (this.denoImports) {
      for (const [k, v] of Object.entries(this.denoImports)) {
        if (spec === k || (k.endsWith('/') && spec.startsWith(k))) {
          spec = v + spec.slice(k.length);
          break;
        }
      }
    }
    if (spec.startsWith('file://')) spec = spec.slice(7);
    if (spec.startsWith('.') || path.isAbsolute(spec)) {
      const file = this.probe(path.resolve(path.dirname(fromFile), spec));
      if (file && !file.includes(`${path.sep}node_modules${path.sep}`)) return { file };
      return file ? { pkg: spec } : null;
    }
    const bare = spec.startsWith('node:') ? spec.slice(5) : spec;
    if (BUILTINS.has(bare) || BUILTINS.has(bare.split('/')[0])) return { pkg: bare };
    for (const a of this.aliases) {
      if (a.exact ? spec !== a.prefix : !(spec.startsWith(a.prefix) && spec.endsWith(a.suffix) && spec.length >= a.prefix.length + a.suffix.length)) continue;
      const middle = a.exact ? '' : spec.slice(a.prefix.length, spec.length - a.suffix.length);
      for (const t of a.targets) {
        const file = this.probe(t.replace('*', middle));
        if (file) return { file };
      }
    }
    if (this.baseUrl && !spec.startsWith('@')) {
      const file = this.probe(path.join(this.baseUrl, spec));
      if (file) return { file };
    }
    return { pkg: packageSpec(spec) };
  }
}
