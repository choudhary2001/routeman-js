// A small YAML reader for OpenAPI documents (no dependencies).
// Supports block mappings and sequences, flow collections, quoted and plain scalars,
// block scalars (| and >), comments, anchors and aliases. Takes the first document.

class YamlError extends Error {}

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote && (quote === "'" || line[i - 1] !== '\\')) quote = null;
    } else if (c === '"' || c === "'") {
      if (i === 0 || /[\s:[{,-]/.test(line[i - 1])) quote = c;
    } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).replace(/\s+$/, '');
    }
  }
  return line.replace(/\s+$/, '');
}

function scalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s === 'true' || s === 'True' || s === 'TRUE') return true;
  if (s === 'false' || s === 'False' || s === 'FALSE') return false;
  if (/^[-+]?\d+$/.test(s)) return Number(s);
  if (/^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
  if (/^0x[0-9a-fA-F]+$/.test(s)) return parseInt(s, 16);
  if (s.startsWith('"')) return JSON.parse(s.replace(/\\\//g, '/').replace(/\t/g, '\\t'));
  if (s.startsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

/** Flow collections: [a, b, {c: d}] */
function parseFlow(text, anchors) {
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const value = () => {
    ws();
    const c = text[i];
    if (c === '[') {
      i++;
      const out = [];
      ws();
      if (text[i] === ']') { i++; return out; }
      for (;;) {
        out.push(value());
        ws();
        if (text[i] === ',') { i++; ws(); if (text[i] === ']') { i++; return out; } continue; }
        if (text[i] === ']') { i++; return out; }
        throw new YamlError('bad flow sequence');
      }
    }
    if (c === '{') {
      i++;
      const out = {};
      ws();
      if (text[i] === '}') { i++; return out; }
      for (;;) {
        const k = token(':');
        if (text[i] === ':') i++;
        const v = text[i - 1] === ':' ? value() : null;
        out[k] = v;
        ws();
        if (text[i] === ',') { i++; ws(); if (text[i] === '}') { i++; return out; } continue; }
        if (text[i] === '}') { i++; return out; }
        throw new YamlError('bad flow mapping');
      }
    }
    return scalarOrAlias(token(''));
  };
  const token = (stopAlso) => {
    ws();
    if (text[i] === '"' || text[i] === "'") {
      const q = text[i];
      let j = i + 1;
      while (j < text.length && !(text[j] === q && (q === "'" ? text[j + 1] !== "'" : text[j - 1] !== '\\'))) j += q === "'" && text[j] === "'" && text[j + 1] === "'" ? 2 : 1;
      const raw = text.slice(i, j + 1);
      i = j + 1;
      return scalar(raw);
    }
    let j = i;
    while (j < text.length && !',]}'.includes(text[j]) && !(stopAlso && text[j] === ':' && /\s|$/.test(text[j + 1] || ''))) j++;
    const raw = text.slice(i, j);
    i = j;
    return raw.trim();
  };
  const scalarOrAlias = (t) => {
    if (typeof t === 'string' && t.startsWith('*')) return anchors.get(t.slice(1));
    return typeof t === 'string' ? scalar(t) : t;
  };
  const v = value();
  return v;
}

export function parseYaml(text) {
  const docs = text.replace(/\r\n?/g, '\n').split(/^---\s*$/m);
  const doc = docs.find((d) => d.trim() && !/^\s*(%|#)/.test(d.trim())) || docs[0] || '';
  const rawLines = doc.split('\n');
  const lines = [];
  for (let n = 0; n < rawLines.length; n++) {
    const raw = rawLines[n];
    if (/^\s*$/.test(raw) || /^\s*#/.test(raw)) { lines.push({ indent: -1, text: '', raw, n }); continue; }
    const indent = raw.length - raw.trimStart().length;
    lines.push({ indent, text: stripComment(raw.trimStart()), raw, n });
  }
  const anchors = new Map();
  let pos = 0;

  const skipBlank = () => { while (pos < lines.length && lines[pos].indent < 0) pos++; };

  function blockScalar(header, parentIndent) {
    const fold = header[0] === '>';
    const chomp = header.includes('-') ? 'strip' : header.includes('+') ? 'keep' : 'clip';
    const out = [];
    let indent = null;
    while (pos < lines.length) {
      const l = lines[pos];
      if (l.indent >= 0 && l.indent <= parentIndent) break;
      if (l.indent < 0) { out.push(''); pos++; continue; }
      if (indent === null) indent = l.indent;
      out.push(l.raw.slice(indent));
      pos++;
    }
    while (out.length && out[out.length - 1] === '' && chomp !== 'keep') out.pop();
    let s = fold ? out.reduce((acc, line, i) => acc + (i === 0 ? '' : line === '' || out[i - 1] === '' ? '\n' : ' ') + line, '') : out.join('\n');
    if (chomp !== 'strip') s += '\n';
    return s;
  }

  function withAnchor(text) {
    const m = /^&(\S+)\s*(.*)$/.exec(text);
    return m ? { anchor: m[1], rest: m[2] } : { anchor: null, rest: text };
  }

  function inlineValue(text, indent) {
    const { anchor, rest } = withAnchor(text);
    let v;
    if (rest === '') v = parseNode(indent);
    else if (/^[|>][-+]?\d*$/.test(rest)) v = blockScalar(rest, indent);
    else if (rest.startsWith('*')) v = anchors.get(rest.slice(1).trim());
    else if (rest.startsWith('[') || rest.startsWith('{')) v = parseFlow(collectFlow(rest, indent), anchors);
    else v = multilinePlain(rest, indent);
    if (anchor) anchors.set(anchor, v);
    return v;
  }

  function collectFlow(first, indent) {
    let text = first;
    let depth = 0;
    const count = (s) => { for (const c of s) { if (c === '[' || c === '{') depth++; else if (c === ']' || c === '}') depth--; } };
    count(first);
    while (depth > 0 && pos < lines.length) {
      const l = lines[pos++];
      if (l.indent < 0) continue;
      text += ' ' + l.text;
      count(l.text);
    }
    void indent;
    return text;
  }

  function multilinePlain(first, indent) {
    if (/^["']/.test(first) && !isClosed(first)) {
      let text = first;
      while (pos < lines.length && !isClosed(text)) {
        const l = lines[pos++];
        text += ' ' + (l.indent < 0 ? '' : l.text);
      }
      return scalar(text);
    }
    let text = first;
    while (pos < lines.length) {
      const l = lines[pos];
      if (l.indent < 0) break;
      if (l.indent <= indent || /^(- |-$)/.test(l.text) || /^[^'"\s][^:]*:(\s|$)/.test(l.text)) break;
      text += ' ' + l.text;
      pos++;
    }
    return scalar(text);
  }

  function isClosed(t) {
    const q = t[0];
    if (q !== '"' && q !== "'") return true;
    for (let i = 1; i < t.length; i++) {
      if (t[i] === q) {
        if (q === "'" && t[i + 1] === "'") { i++; continue; }
        if (q === '"' && t[i - 1] === '\\') continue;
        return i === t.length - 1 || /^\s*$/.test(t.slice(i + 1));
      }
    }
    return false;
  }

  function splitKey(text) {
    if (text[0] === '"' || text[0] === "'") {
      const q = text[0];
      let j = 1;
      while (j < text.length && !(text[j] === q && (q === "'" ? text[j + 1] !== "'" : text[j - 1] !== '\\'))) j += q === "'" && text[j] === "'" ? 2 : 1;
      const rest = text.slice(j + 1);
      const m = /^\s*:(\s+|$)(.*)$/.exec(rest);
      if (!m) return null;
      return { key: String(scalar(text.slice(0, j + 1))), value: m[2] };
    }
    const m = /^([^:]*?(?::(?!\s|$)[^:]*?)*):(\s+|$)(.*)$/.exec(text);
    if (!m) return null;
    return { key: m[1].trim(), value: m[3] };
  }

  function parseNode(parentIndent) {
    skipBlank();
    if (pos >= lines.length) return null;
    const l = lines[pos];
    if (l.indent <= parentIndent) return null;
    const indent = l.indent;
    if (l.text === '-' || l.text.startsWith('- ')) return parseSeq(indent);
    if (splitKey(l.text)) return parseMap(indent);
    pos++;
    return inlineValue(l.text, parentIndent);
  }

  function parseSeq(indent) {
    const out = [];
    for (;;) {
      skipBlank();
      if (pos >= lines.length) break;
      const l = lines[pos];
      if (l.indent !== indent || !(l.text === '-' || l.text.startsWith('- '))) break;
      const rest = l.text === '-' ? '' : l.text.slice(2).trimStart();
      if (rest === '') { pos++; out.push(parseNode(indent)); continue; }
      const kv = splitKey(rest);
      if (kv && !/^[[{]/.test(rest)) {
        // "- key: value" starts a mapping whose indent is the item content column
        const inner = indent + (l.text.length - rest.length);
        lines[pos] = { ...l, indent: inner, text: rest };
        out.push(parseMap(inner));
      } else {
        pos++;
        out.push(inlineValue(rest, indent));
      }
    }
    return out;
  }

  function parseMap(indent) {
    const out = {};
    for (;;) {
      skipBlank();
      if (pos >= lines.length) break;
      const l = lines[pos];
      if (l.indent !== indent) break;
      const kv = splitKey(l.text);
      if (!kv) break;
      pos++;
      if (kv.key === '<<') {
        const v = inlineValue(kv.value, indent);
        if (v && typeof v === 'object') Object.assign(out, v);
        continue;
      }
      if (kv.value === '' ) {
        skipBlank();
        const next = lines[pos];
        if (next && next.indent === indent && (next.text === '-' || next.text.startsWith('- '))) { out[kv.key] = parseSeq(indent); continue; }
      }
      out[kv.key] = inlineValue(kv.value, indent);
    }
    return out;
  }

  const result = parseNode(-1);
  return result;
}

export { YamlError };
