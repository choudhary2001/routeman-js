// Path normalisation, variable names, folders and request titles.

/** Placeholders in normalised paths: /users/{userId} */
export const PARAM = /\{(\w+)\}/g;
const PARAM_FULL = /^\{(\w+)\}$/;
const VERSION = /^v\d+(\.\d+)?$/i;
const PREFIXES = new Set(['api', 'apis', 'rest', 'json']);

export function singular(word) {
  const w = word.toLowerCase();
  if (w.endsWith('ies') && w.length > 3) return word.slice(0, -3) + 'y';
  if (/(ss|x|z|ch|sh)es$/.test(w)) return word.slice(0, -2);
  if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) return word.slice(0, -1);
  return word;
}

export function snake(text) {
  return String(text)
    .replace(/[^0-9a-zA-Z]+/g, '_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

export function camel(text) {
  const s = snake(text);
  return s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

export function humanize(name) {
  const s = snake(name).replace(/_/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function segments(path) {
  return path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
}

/**
 * Rename ambiguous {id}/{pk} after the collection they index: /users/{id} -> {userId}.
 * Variable style follows the project: camelCase unless the path already uses snake_case.
 */
export function variableNames(path) {
  const renames = {};
  const parts = segments(path);
  const snakeStyle = parts.some((p) => /^\{\w+_\w+\}$/.test(p));
  parts.forEach((part, i) => {
    const m = PARAM_FULL.exec(part);
    if (!m) return;
    const name = m[1];
    const low = name.toLowerCase();
    if (['id', 'pk', 'uuid', 'key', 'slug', '_id'].includes(low) && i > 0 && !PARAM_FULL.test(parts[i - 1])) {
      const base = snake(singular(parts[i - 1]));
      const suffix = low === 'pk' || low === '_id' ? 'id' : low;
      renames[name] = snakeStyle ? `${base}_${suffix}` : camel(`${base}_${suffix}`);
    }
  });
  return renames;
}

/** First meaningful path segment: /api/v1/users/{id} -> users. */
export function resource(path, folder = '') {
  for (const part of segments(path)) {
    const low = part.toLowerCase();
    if (PARAM_FULL.test(part) || PREFIXES.has(low) || VERSION.test(low) || low === folder.toLowerCase()) continue;
    return part;
  }
  return '';
}

export function title(route) {
  return route.name || `${route.method} ${route.path}`;
}

/** Join URL pieces with single slashes; '' and '/' collapse. */
export function joinPath(...parts) {
  let out = parts.filter((p) => p != null && p !== '').join('/').replace(/\/{2,}/g, '/');
  if (!out.startsWith('/')) out = '/' + out;
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out;
}
