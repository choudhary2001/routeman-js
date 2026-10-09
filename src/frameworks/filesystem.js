// File-system routing: Next.js (app + pages), Nuxt / Nitro / h3, SvelteKit, Astro, Remix / React Router.
import fs from 'node:fs';
import path from 'node:path';
import { joinPath } from '../naming.js';
import { normalizePath } from '../analyze/routes.js';
import { SOURCE_EXTS } from '../analyze/resolve.js';
import { flatten } from '../analyze/routes.js';

const HTTP = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function walk(dir, filter, out = [], depth = 0) {
  if (depth > 15) return out;
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of names) {
    if (d.name === 'node_modules' || d.name.startsWith('.')) continue;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) walk(full, filter, out, depth + 1);
    else if (filter(d.name, full)) out.push(full);
  }
  return out;
}

const isSource = (n) => SOURCE_EXTS.includes(path.extname(n)) && !/\.d\.[cm]?ts$/.test(n) && !/\.(test|spec)\./.test(n);

/** "[id]" -> "{id}", "[...slug]" -> "{slug}", "[[...slug]]" -> "{slug}", "(group)" -> "", "@slot" -> "". */
function segment(seg, style) {
  if (/^\(.*\)$/.test(seg) && style !== 'remix') return '';
  if (seg.startsWith('@')) return '';
  let m = /^\[\[\.\.\.(\w+)\]\]$/.exec(seg) || /^\[\.\.\.(\w+)\]$/.exec(seg) || /^\[\[(\w+)\]\]$/.exec(seg);
  if (m) return `{${m[1]}}`;
  m = /^\[(\w+)(?:=(\w+))?\]$/.exec(seg);
  if (m) return `{${m[1]}}`;
  if (/^\[\.\.\.\]$/.test(seg) || seg === '[...]') return '{path}';
  return seg.replace(/\[(\w+)\]/g, '{$1}');
}

function exportsOf(interp, rec) {
  const names = rec.esm ? [...interp.exportNames(rec)] : [];
  const cjs = !rec.esm ? interp.cjsExports(rec) : null;
  const get = (n) => (rec.esm ? interp.getExport(rec, n) : cjs ? interp.getMember(cjs, n) : null);
  return { names, get };
}

function mkFlat(fullPath, methods, handler, fw, rec, interp, extra = {}) {
  const { path: p, params } = normalizePath(fullPath);
  return { t: 'route', methods, path: p, fullPath: p, params, chain: handler ? [handler] : [], handlers: handler ? [handler] : [], fw, meta: {}, where: path.relative(interp.root, rec.file), opts: null, guards: [], ...extra };
}

function configBasePath(interp, root) {
  for (const n of ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.cjs']) {
    const f = path.join(root, n);
    if (!fs.existsSync(f)) continue;
    const rec = interp.loadModule(f);
    let cfg = rec.esm ? interp.getExport(rec, 'default') : interp.cjsExports(rec);
    if (cfg && cfg.k === 'f') cfg = interp.callFunction(cfg, [], undefined, null);
    if (cfg && cfg.k === 'o') {
      const b = cfg.props.get('basePath');
      if (b && b.k === 's') return b.v;
    }
  }
  return '';
}

// --- Next.js ---------------------------------------------------------------------------------

function nextRoutes(interp, root, analyse, cache) {
  const out = [];
  const base = configBasePath(interp, root);
  for (const appDir of ['app', 'src/app']) {
    const dir = path.join(root, appDir);
    for (const file of walk(dir, (n) => /^route\.(c|m)?[jt]sx?$/.test(n))) {
      const rel = path.relative(dir, path.dirname(file)).split(path.sep).filter(Boolean);
      if (rel.some((s) => s.startsWith('_'))) continue;
      const url = joinPath(base, ...rel.map((s) => segment(s, 'next')));
      const rec = interp.loadModule(file);
      const { names, get } = exportsOf(interp, rec);
      for (const m of HTTP) {
        if (!names.includes(m)) continue;
        const h = get(m);
        out.push(...analyse(interp, mkFlat(url, [m], h, 'next-app', rec, interp), cache));
      }
    }
  }
  for (const pagesDir of ['pages/api', 'src/pages/api']) {
    const dir = path.join(root, pagesDir);
    for (const file of walk(dir, isSource)) {
      const relFile = path.relative(dir, file).replace(/\.[^.]+$/, '');
      const parts = relFile.split(path.sep).filter(Boolean);
      if (parts[parts.length - 1] === 'index') parts.pop();
      const url = joinPath(base, 'api', ...parts.map((s) => segment(s, 'next')));
      const rec = interp.loadModule(file);
      const h = rec.esm ? interp.getExport(rec, 'default') : interp.cjsExports(rec);
      if (h && h.k === 'r') {
        // next-connect router exported as default handler
        for (const e of h.entries.filter((x) => x.t === 'route')) {
          out.push(...analyse(interp, mkFlat(joinPath(url, e.path || ''), e.methods, null, 'next-pages', rec, interp, { chain: [...h.entries.filter((x) => x.t === 'use').flatMap((x) => x.mws), ...e.handlers] }), cache));
        }
      } else if (h && (h.k === 'f' || h.k === 'p')) {
        out.push(...analyse(interp, mkFlat(url, ['ALL'], h, 'next-pages', rec, interp), cache));
      }
    }
  }
  return out;
}

// --- Nuxt / Nitro / h3 -----------------------------------------------------------------------

function nitroRoutes(interp, root, analyse, cache) {
  const out = [];
  const dirs = [['server/api', '/api'], ['server/routes', ''], ['api', '/api'], ['routes', ''], ['src/api', '/api'], ['src/routes', '']];
  const seen = new Set();
  for (const [d, prefix] of dirs) {
    const dir = path.join(root, d);
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir, isSource)) {
      if (seen.has(file)) continue;
      seen.add(file);
      const relFile = path.relative(dir, file).replace(/\.[^.]+$/, '');
      const parts = relFile.split(path.sep).filter(Boolean);
      let last = parts.pop();
      let method = 'ALL';
      const mm = /^(.*)\.(get|post|put|patch|delete|head|options)$/i.exec(last);
      if (mm) { last = mm[1]; method = mm[2].toUpperCase(); }
      if (last !== 'index') parts.push(last);
      const url = joinPath(prefix, ...parts.map((s) => segment(s, 'nitro')));
      const rec = interp.loadModule(file);
      let h = rec.esm ? interp.getExport(rec, 'default') : interp.cjsExports(rec);
      if (h && h.k === 'o' && h.props.get('handler')) h = h.props.get('handler');
      if (!h || (h.k !== 'f' && h.k !== 'p')) continue;
      out.push(...analyse(interp, mkFlat(url, [method], h, 'h3', rec, interp), cache));
    }
  }
  return out;
}

// --- SvelteKit -------------------------------------------------------------------------------

function svelteRoutes(interp, root, analyse, cache) {
  const out = [];
  const dir = path.join(root, 'src/routes');
  for (const file of walk(dir, (n) => /^\+server\.(c|m)?[jt]s$/.test(n))) {
    const rel = path.relative(dir, path.dirname(file)).split(path.sep).filter(Boolean);
    const url = joinPath(...rel.map((s) => segment(s, 'svelte')));
    const rec = interp.loadModule(file);
    const { names, get } = exportsOf(interp, rec);
    for (const m of [...HTTP, 'fallback']) {
      if (!names.includes(m)) continue;
      out.push(...analyse(interp, mkFlat(url, [m === 'fallback' ? 'ALL' : m], get(m), 'sveltekit', rec, interp), cache));
    }
  }
  return out;
}

// --- Astro -----------------------------------------------------------------------------------

function astroRoutes(interp, root, analyse, cache) {
  const out = [];
  const dir = path.join(root, 'src/pages');
  for (const file of walk(dir, (n) => /\.(c|m)?[jt]s$/.test(n) && !/\.d\.ts$/.test(n))) {
    const relFile = path.relative(dir, file).replace(/\.(c|m)?[jt]s$/, '');
    const parts = relFile.split(path.sep).filter(Boolean);
    if (parts[parts.length - 1] === 'index') parts.pop();
    if (parts.some((p) => p.startsWith('_'))) continue;
    const url = joinPath(...parts.map((s) => segment(s, 'astro')));
    const rec = interp.loadModule(file);
    const { names, get } = exportsOf(interp, rec);
    for (const m of [...HTTP, 'ALL', 'DEL', 'all', 'get', 'post', 'put', 'patch', 'del']) {
      if (!names.includes(m)) continue;
      const method = m.toUpperCase() === 'DEL' ? 'DELETE' : m.toUpperCase();
      out.push(...analyse(interp, mkFlat(url, [method], get(m), 'astro', rec, interp), cache));
    }
  }
  return out;
}

// --- Remix / React Router resource routes ------------------------------------------------------

function remixRoutes(interp, root, analyse, cache) {
  const out = [];
  const dir = path.join(root, 'app/routes');
  for (const file of walk(dir, isSource, [], 0)) {
    const relFile = path.relative(dir, file).replace(/\.[^.]+$/, '').replace(/\/route$/, '');
    const rec = interp.loadModule(file);
    const { names, get } = exportsOf(interp, rec);
    if (names.includes('default')) continue; // UI route, not an API endpoint
    if (!names.includes('loader') && !names.includes('action')) continue;
    const segs = relFile.split(/[./]/).filter(Boolean).filter((s) => s !== '_index' && !/^_/.test(s)).map((s) => (s.startsWith('$') ? (s === '$' ? '{path}' : `{${s.slice(1)}}`) : s.replace(/^\((.*)\)$/, '$1')));
    const url = joinPath(...segs);
    if (names.includes('loader')) out.push(...analyse(interp, mkFlat(url, ['GET'], get('loader'), 'remix', rec, interp), cache));
    if (names.includes('action')) out.push(...analyse(interp, mkFlat(url, ['ALL'], get('action'), 'remix', rec, interp, { actionOnly: true }), cache));
  }
  return out;
}

export function fileRoutes(interp, root, want, cache, analyse) {
  const out = [];
  if (want.has('next')) out.push(...nextRoutes(interp, root, analyse, cache));
  if (want.has('nuxt') || want.has('nitro')) {
    interp.state.autoImports = true;
    out.push(...nitroRoutes(interp, root, analyse, cache));
  }
  if (want.has('sveltekit')) out.push(...svelteRoutes(interp, root, analyse, cache));
  if (want.has('astro')) out.push(...astroRoutes(interp, root, analyse, cache));
  if (want.has('remix')) out.push(...remixRoutes(interp, root, analyse, cache));
  void flatten;
  return out;
}
