// Sample values for request fields: by declared type first, then by field name.
import { NONE } from './model.js';
import { snake } from './naming.js';

export const SAMPLE_UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
export const SAMPLE_OBJECTID = '64b7f9c2e4b0a1a2b3c4d5e6';

// Field-name hints (matched against the snake_case name), first match wins.
const NAME_HINTS = [
  [/(^|_)e?mail(_address|_id)?$/, 'email', 'user@example.com'],
  [/(^|_)confirm(ed)?_?pass|pass(word)?_?confirm|(^|_)re_?password$/, 'string', 'Str0ngPassw0rd!'],
  [/password|passwd|(^|_)pass$|secret/, 'string', 'Str0ngPassw0rd!'],
  [/(^|_)(phone|mobile|contact_number|phone_number|mobile_number|whatsapp)$/, 'string', '+919876543210'],
  [/(^|_)(username|user_name|login)$/, 'string', 'johndoe'],
  [/(^|_)first_?name$/, 'string', 'John'],
  [/(^|_)last_?name$/, 'string', 'Doe'],
  [/(^|_)(full_?name|name|display_name)$/, 'string', 'John Doe'],
  [/(^|_)(url|link|website|homepage|avatar|image|photo|picture|thumbnail|logo)(_url)?$/, 'url', 'https://example.com'],
  [/(^|_)(slug)$/, 'string', 'sample-slug'],
  [/(^|_)(title|subject|heading)$/, 'string', 'Sample title'],
  [/(^|_)(description|bio|about|summary|content|body|text|message|comment|caption|note|notes|details|reason)$/, 'string', 'Sample text'],
  [/(^|_)(otp|code|pin|verification_code)$/, 'string', '123456'],
  [/(^|_)refresh(_token)?$/, 'string', '{{refresh_token}}'],
  [/(^|_)(token|access|access_token|id_token|jwt)$/, 'string', '{{access_token}}'],
  [/(^|_)(city)$/, 'string', 'Mumbai'],
  [/(^|_)(state)$/, 'string', 'Maharashtra'],
  [/(^|_)(country)$/, 'string', 'India'],
  [/(^|_)(country_code)$/, 'string', 'IN'],
  [/(^|_)(zip|zipcode|zip_code|postal_code|pincode|pin_code)$/, 'string', '400001'],
  [/(^|_)(address|street|address_line_?1)$/, 'string', '221B Baker Street'],
  [/(^|_)(gender)$/, 'string', 'male'],
  [/(^|_)(currency)$/, 'string', 'INR'],
  [/(^|_)(lang|language|locale)$/, 'string', 'en'],
  [/(^|_)(timezone|tz)$/, 'string', 'Asia/Kolkata'],
  [/(^|_)(color|colour)$/, 'string', '#3366ff'],
  [/(^|_)(ip|ip_address)$/, 'string', '127.0.0.1'],
  [/(^|_)(dob|date_of_birth|birth_date|birthday|birthdate)$/, 'date', '2000-01-31'],
  [/(^|_)(sort|order_by|ordering|sort_by)$/, 'string', 'createdAt'],
  [/(^|_)(order|direction|sort_order|dir)$/, 'string', 'asc'],
  [/(^|_)(q|query|search|keyword|term|filter)$/, 'string', 'sample'],
  [/(^|_)role$/, 'string', 'user'],
  [/(^|_)(status)$/, 'string', 'active'],
  [/(^|_)(tags?)$/, 'string', 'sample'],
];

// Integer hints for untyped fields that are clearly numeric.
const NUMBER_HINTS = [
  [/(^|_)(page|page_number|page_no)$/, 1],
  [/(^|_)(limit|per_page|page_size|size|take|count|top)$/, 10],
  [/(^|_)(offset|skip)$/, 0],
  [/(^|_)(age)$/, 25],
  [/(^|_)(quantity|qty)$/, 1],
  [/(^|_)(price|amount|total|cost|salary|balance)$/, 100],
  [/(^|_)(rating|stars|score)$/, 5],
  [/(^|_)(year)$/, 2026],
  [/(^|_)(month)$/, 1],
  [/(^|_)(lat|latitude)$/, 19.076],
  [/(^|_)(lng|lon|longitude)$/, 72.8777],
];

export function byType(kind) {
  switch (kind) {
    case 'integer': return 1;
    case 'number': return 1.5;
    case 'boolean': return true;
    case 'uuid': return SAMPLE_UUID;
    case 'objectid': return SAMPLE_OBJECTID;
    case 'date': return '2026-01-31';
    case 'datetime': return '2026-01-31T10:00:00Z';
    case 'time': return '10:00:00';
    case 'email': return 'user@example.com';
    case 'url': return 'https://example.com';
    case 'file': return null;
    case 'object': return {};
    case 'array': return [];
    default: return 'string';
  }
}

/** Make a value JSON-serialisable. */
export function plain(value) {
  if (value === undefined || value === NONE) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = plain(v);
    return out;
  }
  if (typeof value === 'bigint') return Number(value);
  return value;
}

function nameHint(f) {
  const name = snake(f.name || '');
  if (!name) return NONE;
  if (f.type === 'integer' || f.type === 'number' || f.type === 'any' || f.type === 'string') {
    for (const [re, value] of NUMBER_HINTS) {
      if (re.test(name) && (f.type !== 'string')) return f.type === 'integer' ? Math.round(value) : value;
    }
  }
  if (f.type === 'string' || f.type === 'any') {
    for (const [re, , value] of NAME_HINTS) if (re.test(name)) return value;
  }
  return NONE;
}

function fit(f, value) {
  const lim = f.limits;
  if (!lim) return value;
  if (typeof value === 'string' && !/^\{\{.*\}\}$/.test(value)) {
    if (lim.maxLength != null && value.length > lim.maxLength) value = value.slice(0, Math.max(lim.maxLength, 0));
    if (lim.minLength != null && value.length < lim.minLength) {
      value = (value || 'x').repeat(Math.ceil(lim.minLength / Math.max(value.length, 1)) + 1).slice(0, Math.max(lim.minLength, value.length));
    }
  } else if (typeof value === 'number') {
    if (lim.min != null && value < lim.min) value = lim.min;
    if (lim.exclusiveMin != null && value <= lim.exclusiveMin) value = lim.exclusiveMin + 1;
    if (lim.max != null && value > lim.max) value = lim.max;
    if (lim.exclusiveMax != null && value >= lim.exclusiveMax) value = lim.exclusiveMax - 1;
    if (f.type === 'integer') value = Math.round(value);
  } else if (Array.isArray(value) && lim.minItems > 1 && value.length) {
    value = Array.from({ length: lim.minItems }, () => value[0]);
  }
  return value;
}

const ID_NAME = /(^|_)(id|ids|pk|count|qty|quantity|page|limit|year|age|stock)$/;

export function example(f, depth = 0) {
  if (f.type === 'number' && f.example === NONE && f.default === NONE && !(f.choices && f.choices.length) && ID_NAME.test(snake(f.name || ''))) {
    return fit(f, nameHint({ ...f, type: 'integer' }) !== NONE ? nameHint({ ...f, type: 'integer' }) : 1);
  }
  if (f.example !== NONE) return plain(f.example);
  if (f.default !== NONE && f.default !== undefined && f.default !== null && typeof f.default !== 'function') {
    return plain(f.default);
  }
  if (f.choices && f.choices.length) return plain(f.choices[0]);
  if (f.type === 'object') {
    if (depth > 6) return {};
    const out = {};
    for (const c of f.children || []) out[c.name] = example(c, depth + 1);
    return out;
  }
  if (f.type === 'array') {
    if (!f.item || depth > 6) return [];
    return fit(f, [example({ ...f.item, name: f.item.name || f.name }, depth + 1)]);
  }
  if (f.limits && f.limits.pattern && (f.type === 'string' || f.type === 'any')) {
    const hint = nameHint(f);
    const sample = fromRegex(f.limits.pattern);
    if (typeof hint === 'string' && safeTest(f.limits.pattern, hint)) return hint;
    if (sample !== null) return sample;
  }
  const hint = nameHint(f);
  if (hint !== NONE) return fit(f, hint);
  return fit(f, byType(f.type));
}

export function bodyExample(fields) {
  const out = {};
  for (const f of fields) out[f.name] = example(f);
  return out;
}

/** Path values: by type, then by name for ids. */
export function pathExample(f, idStyle = 'integer') {
  let value;
  if (f.example !== NONE) value = plain(f.example);
  else if (f.choices && f.choices.length) value = f.choices[0];
  else if (f.type === 'string' || f.type === 'any') {
    const name = snake(f.name || '');
    if (/(^|_)(uuid|guid)$/.test(name)) value = SAMPLE_UUID;
    else if (/(^|_)(id|pk)$/.test(name)) value = idStyle === 'objectid' ? SAMPLE_OBJECTID : idStyle === 'uuid' ? SAMPLE_UUID : 1;
    else if (/slug/.test(name)) value = 'sample-slug';
    else if (/(^|_)(email)$/.test(name)) value = 'user@example.com';
    else if (/(^|_)(username|user_name|handle)$/.test(name)) value = 'johndoe';
    else value = 'value';
  } else value = f.type === 'number' ? 1 : byType(f.type);
  return value == null ? '' : String(value);
}

function safeTest(source, value) {
  try {
    return new RegExp(source).test(value);
  } catch {
    return false;
  }
}

/**
 * A deterministic string matching a (simple) regular expression: literals, classes, \d \w \s,
 * groups with alternation (first branch), and quantifiers ? * + {n} {n,m}. Returns null if unsure.
 */
export function fromRegex(source) {
  let i = 0;
  const src = String(source);
  const parseSeq = (stop) => {
    let out = '';
    while (i < src.length && !stop.includes(src[i])) {
      let atom;
      const c = src[i];
      if (c === '^' || c === '$') { i++; continue; }
      if (c === '(') {
        i++;
        if (src[i] === '?') { i++; if (src[i] === ':' || src[i] === '=' || src[i] === '!') i++; else if (src[i] === '<') { while (i < src.length && src[i] !== '>') i++; i++; } }
        atom = parseAlt();
        if (src[i] !== ')') return null;
        i++;
      } else if (c === '[') {
        const end = src.indexOf(']', i + 2);
        if (end < 0) return null;
        const body = src.slice(i + 1, end);
        i = end + 1;
        if (body.startsWith('^')) atom = 'x';
        else if (/^\\d/.test(body) || /0-9/.test(body)) atom = '1';
        else if (/a-z/.test(body)) atom = 'a';
        else if (/A-Z/.test(body)) atom = 'A';
        else atom = body.replace(/\\/g, '')[0] || 'a';
      } else if (c === '\\') {
        const n = src[i + 1];
        i += 2;
        atom = { d: '1', w: 'a', s: ' ', D: 'a', W: '-', S: 'a', b: '', B: '' }[n];
        if (atom === undefined) atom = n;
      } else if (c === '.') { atom = 'a'; i++; } else if ('*+?{|)'.includes(c)) return null;
      else { atom = c; i++; }
      if (atom === null) return null;
      let min = 1;
      let max = 1;
      if (src[i] === '?') { min = 0; max = 1; i++; } else if (src[i] === '*') { min = 0; max = 0; i++; } else if (src[i] === '+') { min = 1; i++; } else if (src[i] === '{') {
        const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i));
        if (!m) return null;
        min = Number(m[1]);
        i += m[0].length;
      }
      if (src[i] === '?' || src[i] === '+') i++; // lazy / possessive
      // optional parts are kept once so samples look natural ("978" in an ISBN), * is dropped
      const times = min === 0 && max === 1 ? 1 : min;
      out += atom.repeat(times);
    }
    return out;
  };
  const parseAlt = () => {
    const first = parseSeq('|)');
    if (first === null) return null;
    while (src[i] === '|') { i++; if (parseSeq('|)') === null) return null; }
    return first;
  };
  try {
    const out = parseAlt();
    if (out === null || i < src.length) return null;
    return safeTest(src, out) ? out : null;
  } catch {
    return null;
  }
}
