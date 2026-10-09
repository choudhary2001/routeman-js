// Validation libraries -> routeman fields.
// zod (v3/v4), joi (and celebrate), yup, TypeBox / Elysia `t`, valibot, VineJS, express-validator,
// JSON Schema objects (Fastify, Hapi), class-validator DTO classes (via ts-types.js).
import { NONE, cloneField, field as newField } from '../model.js';
import { SchemaReader } from '../openapi.js';
import { U, arr, jsValue, pkgPath } from './values.js';

const ZOD = new Set(['zod', 'zod/v4', 'zod/v3', 'zod/mini', 'zod/v4-mini', 'zod/v4/mini', 'astro/zod', 'astro:schema', 'astro/schema']);
const JOI = new Set(['joi', '@hapi/joi']);
const YUP = new Set(['yup']);
const TYPEBOX = new Set(['@sinclair/typebox', 'typebox']);
const VALIBOT = new Set(['valibot']);
const VINE = new Set(['@vinejs/vine']);
const EV = new Set(['express-validator']);

/** A schema value. `f` is a Field; required defaults depend on the library. */
function Z(lib, f, extra) {
  return { k: 'z', lib, f, ...extra };
}

function base(lib, type, extra) {
  // zod / typebox / valibot / vine: required unless marked optional; joi / yup: optional unless .required()
  const required = !(lib === 'joi' || lib === 'yup');
  return Z(lib, newField('', type, { required, ...extra }));
}

function lim(f, key, value) {
  if (key === 'pattern' ? typeof value !== 'string' : typeof value !== 'number') return f;
  f.limits = { ...(f.limits || {}), [key]: value };
  return f;
}

function argNum(args, i = 0) {
  const a = args[i];
  return a && a.k === 'n' ? a.v : undefined;
}

function shapeFields(interp, shape, lib) {
  if (!shape || shape.k !== 'o') return [];
  const out = [];
  for (const [key, v] of shape.props) {
    const f = toField(interp, v, key, lib);
    if (f && !f.forbidden) out.push(f);
    if (f && f.confirmed) {
      const c = cloneField(f);
      c.name = `${key}_confirmation`;
      c.confirmed = false;
      out.push(c);
    }
  }
  return out;
}

function choicesOf(v) {
  if (!v) return null;
  if (v.k === 'a') return v.items.map((x) => jsValue(x)).filter((x) => x !== undefined);
  if (v.k === 'o') {
    // TS enum / object of values: { ADMIN: 'admin', USER: 'user' } (skip numeric reverse mappings)
    const vals = [...v.props.values()].map((x) => jsValue(x)).filter((x) => x !== undefined);
    const strings = vals.filter((x) => typeof x === 'string');
    return strings.length ? strings : vals;
  }
  return null;
}

function typeOfChoice(c) {
  if (typeof c === 'number') return Number.isInteger(c) ? 'integer' : 'number';
  if (typeof c === 'boolean') return 'boolean';
  return 'string';
}

function literalField(lib, values) {
  const z = base(lib, values.length ? typeOfChoice(values[0]) : 'string');
  z.f.choices = values;
  return z;
}

function unionOf(interp, lib, options) {
  const items = options && options.k === 'a' ? options.items : [];
  const fields = items.map((x) => toField(interp, x, '', lib)).filter(Boolean);
  if (!fields.length) return base(lib, 'any');
  if (fields.every((f) => f.choices && f.choices.length)) {
    const z = base(lib, fields[0].type);
    z.f.choices = fields.flatMap((f) => f.choices);
    return z;
  }
  const nonNull = fields.filter((f) => !f.isNull);
  return Z(lib, cloneField(nonNull[0] || fields[0]));
}

function mergeObjects(lib, fields) {
  const children = [];
  for (const f of fields) {
    for (const c of (f && f.children) || []) {
      const i = children.findIndex((x) => x.name === c.name);
      if (i >= 0) children[i] = c; else children.push(c);
    }
  }
  return base(lib, 'object', { children });
}

function keysOf(v) {
  if (!v) return [];
  if (v.k === 'a') return v.items.filter((x) => x.k === 's').map((x) => x.v);
  if (v.k === 'o') return [...v.props].filter(([, x]) => x.k === 'b' ? x.v : true).map(([k]) => k);
  if (v.k === 's') return [v.v];
  return [];
}

function pickOmit(z, keys, pick) {
  const out = Z(z.lib, cloneField(z.f));
  out.f.children = (out.f.children || []).filter((c) => keys.includes(c.name) === pick);
  return out;
}

function partial(z, all = true) {
  const out = Z(z.lib, cloneField(z.f));
  out.f.children = (out.f.children || []).map((c) => ({ ...c, required: !all }));
  return out;
}

// --- zod -------------------------------------------------------------------------------------

function zodBuild(interp, name, args) {
  const L = 'zod';
  switch (name) {
    case 'string': return base(L, 'string');
    case 'number': case 'float32': case 'float64': return base(L, 'number');
    case 'int': case 'int32': case 'int64': case 'uint32': case 'bigint': return base(L, 'integer');
    case 'boolean': case 'stringbool': return base(L, 'boolean');
    case 'date': return base(L, 'datetime');
    case 'any': case 'unknown': case 'json': case 'custom': case 'never': case 'void': case 'symbol': return base(L, 'any');
    case 'null': case 'undefined': { const z = base(L, 'any'); z.f.isNull = true; return z; }
    case 'email': return base(L, 'email');
    case 'url': case 'httpUrl': return base(L, 'url');
    case 'uuid': case 'uuidv4': case 'uuidv7': case 'guid': return base(L, 'uuid');
    case 'cuid': case 'cuid2': case 'ulid': case 'nanoid': case 'base64': case 'jwt': case 'emoji': return base(L, 'string');
    case 'ipv4': return Z(L, newField('', 'string', { required: true, example: '127.0.0.1' }));
    case 'e164': return Z(L, newField('', 'string', { required: true, example: '+919876543210' }));
    case 'file': return base(L, 'file');
    case 'iso_datetime': return base(L, 'datetime');
    case 'iso_date': return base(L, 'date');
    case 'iso_time': return base(L, 'time');
    case 'iso_duration': return Z(L, newField('', 'string', { required: true, example: 'P1D' }));
    case 'object': case 'strictObject': case 'looseObject': return base(L, 'object', { children: shapeFields(interp, args[0], L) });
    case 'array': case 'set': {
      const z = base(L, 'array');
      z.f.item = args[0] ? toField(interp, args[0], '', L) : null;
      return z;
    }
    case 'tuple': {
      const z = base(L, 'array');
      z.f.item = args[0] && args[0].k === 'a' && args[0].items[0] ? toField(interp, args[0].items[0], '', L) : null;
      return z;
    }
    case 'record': case 'map': return base(L, 'object', { children: [] });
    case 'enum': case 'nativeEnum': return literalField(L, choicesOf(args[0]) || []);
    case 'literal': {
      const v = args[0];
      const vals = v && v.k === 'a' ? v.items.map((x) => jsValue(x)) : [jsValue(v)];
      return literalField(L, vals.filter((x) => x !== undefined));
    }
    case 'union': return unionOf(interp, L, args[0]);
    case 'discriminatedUnion': return unionOf(interp, L, args[0] && args[0].k === 'a' ? args[0] : args[1]);
    case 'intersection': return mergeObjects(L, args.map((a) => toField(interp, a, '', L)));
    case 'optional': case 'nullable': case 'nullish': {
      const inner = args[0] && args[0].k === 'z' ? args[0] : base(L, 'any');
      return Z(L, { ...cloneField(inner.f), required: name === 'nullable' ? inner.f.required : false });
    }
    case 'lazy': {
      const f = args[0];
      if (f && f.k === 'f') {
        const r = interp.callFunction(f, [], undefined, null);
        if (r && r.k === 'z') return r;
      }
      return base(L, 'any');
    }
    case 'preprocess': return args[1] && args[1].k === 'z' ? args[1] : base(L, 'any');
    case 'instanceof': {
      const c = args[0];
      if (c && /^(File|Blob)$/.test(c.name || '')) return base(L, 'file');
      return base(L, 'any');
    }
    case 'promise': return args[0] && args[0].k === 'z' ? args[0] : base(L, 'any');
    default: return null;
  }
}

function zodMethod(interp, z, key, args) {
  const f = cloneField(z.f);
  const out = Z(z.lib, f);
  switch (key) {
    case 'optional': case 'nullish': case 'exactOptional': f.required = false; return out;
    case 'nullable': return out;
    case 'default': case 'prefault': case 'catch':
      if (args[0] && args[0].k !== 'f' && jsValue(args[0]) !== undefined) f.default = jsValue(args[0]);
      f.required = false;
      return out;
    case 'describe': if (args[0] && args[0].k === 's') f.description = args[0].v; return out;
    case 'meta': case 'openapi': {
      const meta = args.find((a) => a.k === 'o');
      if (meta) {
        const m = jsValue(meta);
        if (m.example !== undefined) f.example = m.example;
        else if (Array.isArray(m.examples) && m.examples.length) f.example = m.examples[0];
        if (m.description) f.description = m.description;
      }
      return out;
    }
    case 'min': case 'gte': case 'nonempty': {
      const n = key === 'nonempty' ? 1 : argNum(args);
      if (f.type === 'array') lim(f, 'minItems', n);
      else if (['string', 'email', 'url'].includes(f.type)) lim(f, 'minLength', n);
      else lim(f, 'min', n);
      return out;
    }
    case 'max': case 'lte': {
      const n = argNum(args);
      if (f.type === 'array') return out;
      if (['string', 'email', 'url'].includes(f.type)) lim(f, 'maxLength', n); else lim(f, 'max', n);
      return out;
    }
    case 'length':
      if (f.type !== 'array') { lim(f, 'minLength', argNum(args)); lim(f, 'maxLength', argNum(args)); } else lim(f, 'minItems', argNum(args));
      return out;
    case 'gt': lim(f, 'exclusiveMin', argNum(args)); return out;
    case 'lt': lim(f, 'exclusiveMax', argNum(args)); return out;
    case 'positive': lim(f, 'exclusiveMin', 0); return out;
    case 'nonnegative': lim(f, 'min', 0); return out;
    case 'negative': lim(f, 'exclusiveMax', 0); return out;
    case 'int': case 'safe': f.type = 'integer'; return out;
    case 'email': f.type = 'email'; return out;
    case 'url': f.type = 'url'; return out;
    case 'uuid': case 'guid': f.type = 'uuid'; return out;
    case 'datetime': f.type = 'datetime'; return out;
    case 'date': f.type = f.type === 'string' ? 'date' : f.type; return out;
    case 'time': f.type = 'time'; return out;
    case 'ip': case 'ipv4': f.example = '127.0.0.1'; return out;
    case 'regex': if (args[0] && args[0].k === 're') lim(f, 'pattern', args[0].source); return out;
    case 'startsWith': if (args[0] && args[0].k === 's') f.example = args[0].v + 'sample'; return out;
    case 'array': { const a = Z(z.lib, newField('', 'array', { required: true, item: f })); return a; }
    case 'or': return unionOf(interp, z.lib, arr([z, args[0]]));
    case 'and': case 'merge': return mergeObjects(z.lib, [f, toField(interp, args[0], '', z.lib)]);
    case 'extend': case 'safeExtend': {
      const extra = args[0] && args[0].k === 'z' ? args[0].f.children || [] : shapeFields(interp, args[0], z.lib);
      return mergeObjects(z.lib, [f, { children: extra }]);
    }
    case 'pick': return pickOmit(out, keysOf(args[0]), true);
    case 'omit': return pickOmit(out, keysOf(args[0]), false);
    case 'partial': case 'deepPartial': return partial(out, true);
    case 'required': return partial(out, false);
    case 'keyof': return literalField(z.lib, (f.children || []).map((c) => c.name));
    case 'unwrap': case 'removeDefault': case 'innerType': case 'removeCatch': return out;
    case 'element': return f.item ? Z(z.lib, cloneField(f.item)) : Z(z.lib, newField('', 'any'));
    case 'pipe': return args[0] && args[0].k === 'z' && f.type === 'any' ? args[0] : out;
    default: return out; // refine, superRefine, transform, brand, readonly, trim, toLowerCase, strict, passthrough, ...
  }
}

// --- joi -------------------------------------------------------------------------------------

function joiBuild(interp, name, args) {
  const L = 'joi';
  switch (name) {
    case 'string': return base(L, 'string');
    case 'number': return base(L, 'number');
    case 'boolean': case 'bool': return base(L, 'boolean');
    case 'date': return base(L, 'datetime');
    case 'any': case 'func': case 'function': case 'link': case 'symbol': case 'binary': return base(L, 'any');
    case 'object': return base(L, 'object', { children: shapeFields(interp, args[0], L) });
    case 'array': return base(L, 'array');
    case 'alternatives': case 'alt': return unionOf(interp, L, args[0] && args[0].k === 'a' ? args[0] : arr(args));
    case 'valid': case 'only': case 'equal': {
      const vals = args.flatMap((a) => (a.k === 'a' ? a.items : [a])).map((a) => jsValue(a)).filter((x) => x !== undefined);
      return literalField(L, vals);
    }
    case 'compile': case 'build': {
      // Joi.compile({ body: Joi.object(...), query: ... }) / Joi.compile(schema)
      const a = args[0];
      if (a && a.k === 'z') return a;
      if (a && a.k === 'o') return base(L, 'object', { children: shapeFields(interp, a, L).map((c) => ({ ...c, required: true })) });
      return base(L, 'any');
    }
    case 'required': case 'exist': { const z = base(L, 'any'); z.f.required = true; return z; }
    case 'optional': return base(L, 'any');
    default: return null;
  }
}

function joiMethod(interp, z, key, args) {
  const f = cloneField(z.f);
  const out = Z(z.lib, f);
  switch (key) {
    case 'required': case 'exist': case 'presence': f.required = key !== 'presence' || (args[0] && args[0].v === 'required'); return out;
    case 'optional': f.required = false; return out;
    case 'forbidden': case 'strip': f.forbidden = true; return out;
    case 'valid': case 'only': case 'equal': {
      const vals = args.flatMap((a) => (a.k === 'a' ? a.items : [a])).map((a) => jsValue(a)).filter((x) => x !== undefined && x !== null);
      if (vals.length) f.choices = vals;
      return out;
    }
    case 'default': if (args[0] && args[0].k !== 'f' && jsValue(args[0]) !== undefined) f.default = jsValue(args[0]); return out;
    case 'example': case 'examples': if (args[0] && jsValue(args[0]) !== undefined) f.example = jsValue(args[0]); return out;
    case 'description': case 'note': if (args[0] && args[0].k === 's') f.description = args[0].v; return out;
    case 'email': f.type = 'email'; return out;
    case 'uri': f.type = 'url'; return out;
    case 'guid': case 'uuid': f.type = 'uuid'; return out;
    case 'isoDate': f.type = f.type === 'datetime' ? 'datetime' : 'datetime'; return out;
    case 'iso': f.type = 'datetime'; return out;
    case 'ip': f.example = '127.0.0.1'; return out;
    case 'integer': f.type = 'integer'; return out;
    case 'min': case 'greater': {
      const n = argNum(args);
      if (f.type === 'array') lim(f, 'minItems', n);
      else if (['string', 'email', 'url'].includes(f.type)) lim(f, 'minLength', n);
      else lim(f, key === 'greater' ? 'exclusiveMin' : 'min', n);
      return out;
    }
    case 'max': case 'less': {
      const n = argNum(args);
      if (f.type === 'array') return out;
      if (['string', 'email', 'url'].includes(f.type)) lim(f, 'maxLength', n); else lim(f, key === 'less' ? 'exclusiveMax' : 'max', n);
      return out;
    }
    case 'length':
      if (f.type === 'array') lim(f, 'minItems', argNum(args)); else { lim(f, 'minLength', argNum(args)); lim(f, 'maxLength', argNum(args)); }
      return out;
    case 'positive': lim(f, 'exclusiveMin', 0); return out;
    case 'pattern': case 'regex': if (args[0] && args[0].k === 're') lim(f, 'pattern', args[0].source); return out;
    case 'items': {
      const item = args.find((a) => a.k === 'z');
      if (item) f.item = toField(interp, item, '', 'joi');
      return out;
    }
    case 'keys': case 'append': {
      const merged = mergeObjects('joi', [f, { children: shapeFields(interp, args[0], 'joi') }]);
      return Z('joi', { ...f, type: 'object', children: merged.f.children });
    }
    case 'concat': return mergeObjects('joi', [f, toField(interp, args[0], '', 'joi')]);
    case 'try': return unionOf(interp, 'joi', args[0] && args[0].k === 'a' ? args[0] : arr(args));
    default: return out;
  }
}

// --- yup -------------------------------------------------------------------------------------

function yupBuild(interp, name, args) {
  const L = 'yup';
  switch (name) {
    case 'string': return base(L, 'string');
    case 'number': return base(L, 'number');
    case 'boolean': case 'bool': return base(L, 'boolean');
    case 'date': return base(L, 'datetime');
    case 'mixed': return base(L, 'any');
    case 'object': return base(L, 'object', { children: shapeFields(interp, args[0], L) });
    case 'array': { const z = base(L, 'array'); if (args[0] && args[0].k === 'z') z.f.item = toField(interp, args[0], '', L); return z; }
    case 'tuple': return base(L, 'array');
    case 'lazy': return base(L, 'any');
    default: return null;
  }
}

function yupMethod(interp, z, key, args) {
  const f = cloneField(z.f);
  const out = Z(z.lib, f);
  switch (key) {
    case 'required': case 'defined': case 'nonNullable': f.required = true; return out;
    case 'optional': case 'notRequired': f.required = false; return out;
    case 'default': if (args[0] && args[0].k !== 'f' && jsValue(args[0]) !== undefined) f.default = jsValue(args[0]); return out;
    case 'oneOf': { const c = choicesOf(args[0]); if (c && c.length) f.choices = c.filter((x) => x !== null); return out; }
    case 'email': f.type = 'email'; return out;
    case 'url': f.type = 'url'; return out;
    case 'uuid': f.type = 'uuid'; return out;
    case 'datetime': f.type = 'datetime'; return out;
    case 'integer': f.type = 'integer'; return out;
    case 'min': case 'moreThan': {
      const n = argNum(args);
      if (f.type === 'array') lim(f, 'minItems', n);
      else if (['string', 'email', 'url'].includes(f.type)) lim(f, 'minLength', n);
      else lim(f, key === 'moreThan' ? 'exclusiveMin' : 'min', n);
      return out;
    }
    case 'max': case 'lessThan': {
      const n = argNum(args);
      if (['string', 'email', 'url'].includes(f.type)) lim(f, 'maxLength', n); else if (f.type !== 'array') lim(f, key === 'lessThan' ? 'exclusiveMax' : 'max', n);
      return out;
    }
    case 'length': lim(f, 'minLength', argNum(args)); lim(f, 'maxLength', argNum(args)); return out;
    case 'positive': lim(f, 'exclusiveMin', 0); return out;
    case 'matches': if (args[0] && args[0].k === 're') lim(f, 'pattern', args[0].source); return out;
    case 'of': if (args[0]) f.item = toField(interp, args[0], '', 'yup'); return out;
    case 'shape': return Z('yup', { ...f, type: 'object', children: mergeObjects('yup', [f, { children: shapeFields(interp, args[0], 'yup') }]).f.children });
    case 'concat': return mergeObjects('yup', [f, toField(interp, args[0], '', 'yup')]);
    case 'pick': return pickOmit(out, keysOf(args[0]), true);
    case 'omit': return pickOmit(out, keysOf(args[0]), false);
    case 'partial': return partial(out, true);
    case 'label': case 'meta': return out;
    default: return out;
  }
}

// --- TypeBox / Elysia t ----------------------------------------------------------------------

const TB_FORMATS = { email: 'email', uuid: 'uuid', 'date-time': 'datetime', date: 'date', time: 'time', uri: 'url', url: 'url' };

function tbOptions(f, opts) {
  if (!opts || opts.k !== 'o') return f;
  const o = jsValue(opts);
  if (o.format && TB_FORMATS[o.format] && ['string', 'any'].includes(f.type)) f.type = TB_FORMATS[o.format];
  if (o.default !== undefined) f.default = o.default;
  if (o.example !== undefined) f.example = o.example;
  else if (Array.isArray(o.examples) && o.examples.length) f.example = o.examples[0];
  if (o.description) f.description = o.description;
  for (const [k, key] of [['minLength', 'minLength'], ['maxLength', 'maxLength'], ['minimum', 'min'], ['maximum', 'max'],
    ['exclusiveMinimum', 'exclusiveMin'], ['exclusiveMaximum', 'exclusiveMax'], ['minItems', 'minItems'], ['pattern', 'pattern']]) {
    if (o[k] !== undefined) f.limits = { ...(f.limits || {}), [key]: o[k] };
  }
  return f;
}

function typeboxBuild(interp, name, args) {
  const L = 'typebox';
  let z;
  switch (name) {
    case 'String': case 'TemplateLiteral': z = base(L, 'string'); tbOptions(z.f, args[0]); return z;
    case 'Number': case 'Numeric': z = base(L, 'number'); tbOptions(z.f, args[0]); return z;
    case 'Integer': z = base(L, 'integer'); tbOptions(z.f, args[0]); return z;
    case 'Boolean': case 'BooleanString': z = base(L, 'boolean'); tbOptions(z.f, args[0]); return z;
    case 'Date': z = base(L, 'datetime'); tbOptions(z.f, args[0]); return z;
    case 'Null': case 'Undefined': case 'Void': z = base(L, 'any'); z.f.isNull = true; return z;
    case 'Any': case 'Unknown': case 'Never': case 'Unsafe': case 'Function': z = base(L, 'any'); tbOptions(z.f, args[0]); return z;
    case 'File': z = base(L, 'file'); return z;
    case 'Files': z = base(L, 'array'); z.f.item = newField('', 'file'); return z;
    case 'Object': case 'ObjectString': z = base(L, 'object', { children: shapeFields(interp, args[0], L) }); tbOptions(z.f, args[1]); return z;
    case 'Array': case 'ArrayString': z = base(L, 'array'); z.f.item = args[0] ? toField(interp, args[0], '', L) : null; tbOptions(z.f, args[1]); return z;
    case 'Tuple': z = base(L, 'array'); return z;
    case 'Record': case 'Cookie': return base(L, 'object', { children: [] });
    case 'Optional': {
      const inner = args[0] && args[0].k === 'z' ? args[0] : base(L, 'any');
      return Z(L, { ...cloneField(inner.f), required: false });
    }
    case 'Readonly': case 'ReadonlyOptional': case 'Nullable': case 'MaybeEmpty': case 'Transform': case 'NoValidate':
      return args[0] && args[0].k === 'z' ? Z(L, { ...cloneField(args[0].f), required: name === 'ReadonlyOptional' ? false : args[0].f.required }) : base(L, 'any');
    case 'Union': return unionOf(interp, L, args[0]);
    case 'Literal': return literalField(L, [jsValue(args[0])].filter((x) => x !== undefined));
    case 'Enum': case 'UnionEnum': { z = literalField(L, choicesOf(args[0]) || []); tbOptions(z.f, args[1]); return z; }
    case 'KeyOf': return literalField(L, args[0] && args[0].k === 'z' ? (args[0].f.children || []).map((c) => c.name) : []);
    case 'Partial': return args[0] && args[0].k === 'z' ? partial(args[0], true) : base(L, 'object');
    case 'Required': return args[0] && args[0].k === 'z' ? partial(args[0], false) : base(L, 'object');
    case 'Pick': return args[0] && args[0].k === 'z' ? pickOmit(args[0], keysOf(args[1]), true) : base(L, 'object');
    case 'Omit': return args[0] && args[0].k === 'z' ? pickOmit(args[0], keysOf(args[1]), false) : base(L, 'object');
    case 'Intersect': case 'Composite': return mergeObjects(L, (args[0] && args[0].k === 'a' ? args[0].items : []).map((a) => toField(interp, a, '', L)));
    case 'Ref': return base(L, 'any');
    default: return null;
  }
}

// --- valibot ---------------------------------------------------------------------------------

function valibotBuild(interp, name, args) {
  const L = 'valibot';
  switch (name) {
    case 'string': return base(L, 'string');
    case 'number': return base(L, 'number');
    case 'bigint': return base(L, 'integer');
    case 'boolean': return base(L, 'boolean');
    case 'date': return base(L, 'datetime');
    case 'file': case 'blob': return base(L, 'file');
    case 'any': case 'unknown': case 'null': case 'undefined': case 'never': return base(L, 'any');
    case 'object': case 'strictObject': case 'looseObject': case 'objectWithRest': return base(L, 'object', { children: shapeFields(interp, args[0], L) });
    case 'array': { const z = base(L, 'array'); z.f.item = args[0] ? toField(interp, args[0], '', L) : null; return z; }
    case 'tuple': case 'set': return base(L, 'array');
    case 'record': case 'map': return base(L, 'object', { children: [] });
    case 'picklist': case 'enum': case 'enum_': return literalField(L, choicesOf(args[0]) || []);
    case 'literal': return literalField(L, [jsValue(args[0])].filter((x) => x !== undefined));
    case 'union': return unionOf(interp, L, args[0]);
    case 'variant': return unionOf(interp, L, args[1]);
    case 'intersect': return mergeObjects(L, (args[0] && args[0].k === 'a' ? args[0].items : []).map((a) => toField(interp, a, '', L)));
    case 'optional': case 'nullish': case 'exactOptional': case 'undefinedable': {
      const inner = args[0] && args[0].k === 'z' ? args[0] : base(L, 'any');
      const f = { ...cloneField(inner.f), required: false };
      if (args[1] && args[1].k !== 'f' && jsValue(args[1]) !== undefined) f.default = jsValue(args[1]);
      return Z(L, f);
    }
    case 'nullable': return args[0] && args[0].k === 'z' ? args[0] : base(L, 'any');
    case 'pipe': case 'pipeAsync': {
      const [first, ...actions] = args;
      if (!first || first.k !== 'z') return base(L, 'any');
      let f = cloneField(first.f);
      for (const a of actions) if (a && a.k === 'z' && a.action) f = applyAction(f, a.action, a.args);
      return Z(L, f);
    }
    case 'partial': return args[0] && args[0].k === 'z' ? partial(args[0], true) : base(L, 'object');
    case 'required': return args[0] && args[0].k === 'z' ? partial(args[0], false) : base(L, 'object');
    case 'pick': return args[0] && args[0].k === 'z' ? pickOmit(args[0], keysOf(args[1]), true) : base(L, 'object');
    case 'omit': return args[0] && args[0].k === 'z' ? pickOmit(args[0], keysOf(args[1]), false) : base(L, 'object');
    case 'lazy': return base(L, 'any');
    default:
      // actions used inside pipe(): email(), minLength(8), ...
      return Z(L, newField('', 'any'), { action: name, args });
  }
}

function applyAction(f, action, args) {
  switch (action) {
    case 'email': case 'rfcEmail': f.type = 'email'; break;
    case 'url': f.type = 'url'; break;
    case 'uuid': f.type = 'uuid'; break;
    case 'isoDate': f.type = 'date'; break;
    case 'isoDateTime': case 'isoTimestamp': f.type = 'datetime'; break;
    case 'isoTime': f.type = 'time'; break;
    case 'integer': f.type = 'integer'; break;
    case 'minLength': case 'nonEmpty': lim(f, f.type === 'array' ? 'minItems' : 'minLength', action === 'nonEmpty' ? 1 : argNum(args)); break;
    case 'maxLength': if (f.type !== 'array') lim(f, 'maxLength', argNum(args)); break;
    case 'length': lim(f, 'minLength', argNum(args)); lim(f, 'maxLength', argNum(args)); break;
    case 'minValue': lim(f, 'min', argNum(args)); break;
    case 'maxValue': lim(f, 'max', argNum(args)); break;
    case 'regex': if (args[0] && args[0].k === 're') lim(f, 'pattern', args[0].source); break;
    case 'description': if (args[0] && args[0].k === 's') f.description = args[0].v; break;
    case 'examples': if (args[0] && args[0].k === 'a' && args[0].items[0]) f.example = jsValue(args[0].items[0]); break;
    default: break;
  }
  return f;
}

// --- VineJS ----------------------------------------------------------------------------------

function vineBuild(interp, name, args) {
  const L = 'vine';
  switch (name) {
    case 'string': return base(L, 'string');
    case 'number': return base(L, 'number');
    case 'boolean': case 'accepted': return base(L, 'boolean');
    case 'date': return base(L, 'date');
    case 'any': case 'unionOfTypes': case 'union': return base(L, 'any');
    case 'file': return base(L, 'file');
    case 'object': return base(L, 'object', { children: shapeFields(interp, args[0], L) });
    case 'array': { const z = base(L, 'array'); z.f.item = args[0] ? toField(interp, args[0], '', L) : null; return z; }
    case 'tuple': return base(L, 'array');
    case 'record': return base(L, 'object', { children: [] });
    case 'enum': return literalField(L, choicesOf(args[0]) || []);
    case 'literal': return literalField(L, [jsValue(args[0])].filter((x) => x !== undefined));
    case 'compile': case 'create': {
      const a = args[0];
      if (a && a.k === 'z') return a;
      if (a && a.k === 'o') return base(L, 'object', { children: shapeFields(interp, a, L) });
      return base(L, 'any');
    }
    default: return null;
  }
}

function vineMethod(interp, z, key, args) {
  const f = cloneField(z.f);
  const out = Z(z.lib, f);
  switch (key) {
    case 'optional': case 'nullable': f.required = key === 'nullable' ? f.required : false; return out;
    case 'requiredWhen': case 'requiredIfExists': case 'requiredIfAnyExists': f.required = false; return out;
    case 'email': case 'normalizeEmail': f.type = 'email'; return out;
    case 'url': case 'activeUrl': f.type = 'url'; return out;
    case 'uuid': f.type = 'uuid'; return out;
    case 'mobile': f.example = '+919876543210'; return out;
    case 'ipAddress': f.example = '127.0.0.1'; return out;
    case 'minLength': lim(f, f.type === 'array' ? 'minItems' : 'minLength', argNum(args)); return out;
    case 'maxLength': if (f.type !== 'array') lim(f, 'maxLength', argNum(args)); return out;
    case 'fixedLength': lim(f, 'minLength', argNum(args)); lim(f, 'maxLength', argNum(args)); return out;
    case 'min': lim(f, 'min', argNum(args)); return out;
    case 'max': lim(f, 'max', argNum(args)); return out;
    case 'range': if (args[0] && args[0].k === 'a') { lim(f, 'min', jsValue(args[0].items[0])); lim(f, 'max', jsValue(args[0].items[1])); } return out;
    case 'positive': lim(f, 'exclusiveMin', 0); return out;
    case 'withoutDecimals': f.type = 'integer'; return out;
    case 'regex': if (args[0] && args[0].k === 're') lim(f, 'pattern', args[0].source); return out;
    case 'in': { const c = choicesOf(args[0]); if (c && c.length) f.choices = c; return out; }
    case 'confirmed': f.confirmed = true; return out;
    case 'compile': return out;
    default: return out;
  }
}

// --- express-validator -----------------------------------------------------------------------

const EV_LOC = { body: 'body', query: 'query', param: 'params', params: 'params', header: 'headers', headers: 'headers', cookie: 'cookies', check: 'any' };

function evBuild(interp, name, args) {
  const loc = EV_LOC[name];
  if (loc) {
    const first = args[0];
    const names = first && first.k === 'a' ? first.items.filter((x) => x.k === 's').map((x) => x.v) : first && first.k === 's' ? [first.v] : [];
    return { k: 'ev', loc, names, f: newField('', 'any', { required: true }) };
  }
  if (name === 'checkSchema') return checkSchema(args[0], args[1]);
  if (name === 'oneOf') return args[0] && args[0].k === 'a' ? args[0] : U;
  if (name === 'matchedData') {
    const col = interp.analyzing;
    if (col) { col.touch('body', []); return { k: 'role', role: 'field', col, loc: 'body', path: [] }; }
  }
  return null;
}

function evApply(f, key, opts) {
  const o = opts && opts.k === 'o' ? jsValue(opts) : {};
  switch (key) {
    case 'optional': f.required = false; break;
    case 'notEmpty': case 'exists': f.required = true; break;
    case 'isEmail': case 'normalizeEmail': f.type = 'email'; break;
    case 'isURL': f.type = 'url'; break;
    case 'isUUID': f.type = 'uuid'; break;
    case 'isMongoId': f.type = 'objectid'; break;
    case 'isInt': case 'toInt': f.type = 'integer'; if (o.min !== undefined) lim(f, 'min', o.min); if (o.max !== undefined) lim(f, 'max', o.max); break;
    case 'isFloat': case 'isNumeric': case 'isDecimal': case 'toFloat': f.type = 'number'; if (o.min !== undefined) lim(f, 'min', o.min); if (o.max !== undefined) lim(f, 'max', o.max); break;
    case 'isBoolean': case 'toBoolean': f.type = 'boolean'; break;
    case 'isISO8601': case 'isDate': case 'toDate': f.type = 'date'; break;
    case 'isArray': f.type = 'array'; if (o.min) lim(f, 'minItems', o.min); break;
    case 'isObject': f.type = 'object'; break;
    case 'isString': case 'isAlpha': case 'isAlphanumeric': if (f.type === 'any') f.type = 'string'; break;
    case 'isMobilePhone': f.example = '+919876543210'; break;
    case 'isStrongPassword': f.example = 'Str0ngPassw0rd!'; break;
    case 'isLength': if (o.min !== undefined) lim(f, 'minLength', o.min); if (o.max !== undefined) lim(f, 'maxLength', o.max); break;
    default: break;
  }
  return f;
}

function evMethod(interp, ev, key, args) {
  const f = cloneField(ev.f);
  const out = { ...ev, f };
  if (key === 'isIn') {
    const c = choicesOf(args[0]);
    if (c && c.length) f.choices = c;
    return out;
  }
  if (key === 'equals' && args[0]) { f.choices = [jsValue(args[0])]; return out; }
  if (key === 'matches' && args[0]) { if (args[0].k === 're') lim(f, 'pattern', args[0].source); return out; }
  if (key === 'default' && args[0]) { f.default = jsValue(args[0]); f.required = false; return out; }
  if (key === 'run') return U;
  evApply(f, key, args[0]);
  return out;
}

function checkSchema(schema, locations) {
  if (!schema || schema.k !== 'o') return U;
  const defaults = locations && locations.k === 'a' ? locations.items.map((x) => x.v) : ['body'];
  const items = [];
  for (const [name, spec] of schema.props) {
    const s = spec && spec.k === 'o' ? spec : null;
    let loc = defaults[0] || 'body';
    const f = newField('', 'any', { required: true });
    if (s) {
      const where = s.props.get('in');
      if (where && where.k === 'a' && where.items[0]) loc = where.items[0].v;
      else if (where && where.k === 's') loc = where.v;
      for (const [key, val] of s.props) {
        if (key === 'in' || key === 'errorMessage' || key === 'custom') continue;
        if (val.k === 'b' && !val.v) continue;
        const opts = val.k === 'o' ? val.props.get('options') : null;
        if (key === 'optional') { f.required = false; continue; }
        if (key === 'isIn' && opts && opts.k === 'a' && opts.items[0]) { f.choices = choicesOf(opts.items[0]); continue; }
        evApply(f, key, opts);
      }
    }
    items.push({ k: 'ev', loc: EV_LOC[loc] || loc, names: [name], f });
  }
  return arr(items);
}

/** Fields declared by express-validator chains, grouped by location. */
export function evFields(chains) {
  const out = { body: [], query: [], params: [], headers: [] };
  for (const ev of chains) {
    const loc = ev.loc === 'any' ? 'body' : ev.loc;
    if (!out[loc]) continue;
    for (const name of ev.names) insertPath(out[loc], name.split('.'), ev.f);
  }
  return out;
}

function insertPath(list, parts, f) {
  const [head, ...rest] = parts;
  if (head === '*') return;
  let node = list.find((x) => x.name === head);
  if (!rest.length) {
    const nf = { ...cloneField(f), name: head };
    if (node) Object.assign(node, nf, { children: node.children || nf.children });
    else list.push(nf);
    return;
  }
  if (!node) {
    node = newField(head, 'object', { required: f.required, children: [] });
    list.push(node);
  }
  if (rest[0] === '*') {
    node.type = 'array';
    if (rest.length === 1) { node.item = { ...cloneField(f), name: head }; return; }
    if (!node.item || node.item.type !== 'object') node.item = newField(head, 'object', { children: [] });
    insertPath(node.item.children, rest.slice(1), f);
    return;
  }
  node.type = 'object';
  node.children = node.children || [];
  insertPath(node.children, rest, f);
}

// --- dispatch --------------------------------------------------------------------------------

function libOf(p) {
  const name = p.pkg;
  let chain = p.chain;
  const strip = (prop) => { if (chain[0] && chain[0].get === prop) chain = chain.slice(1); };
  if (ZOD.has(name) || ((name === '@hono/zod-openapi' || name === '@asteasolutions/zod-to-openapi' || name === 'zod-openapi') && chain[0] && chain[0].get === 'z')) {
    strip('default'); strip('z');
    if (chain[0] && (chain[0].get === 'coerce' || chain[0].get === 'string_format')) chain = chain.slice(1);
    else if (chain[0] && chain[0].get === 'iso' && chain[1] && 'get' in chain[1]) chain = [{ get: 'iso_' + chain[1].get }, ...chain.slice(2)];
    return { lib: 'zod', chain };
  }
  if (JOI.has(name) || (name === 'celebrate' && chain[0] && chain[0].get === 'Joi')) { strip('Joi'); strip('default'); return { lib: 'joi', chain }; }
  if (YUP.has(name)) { strip('default'); strip('yup'); return { lib: 'yup', chain }; }
  if (TYPEBOX.has(name)) { strip('Type'); strip('default'); strip('t'); return { lib: 'typebox', chain }; }
  if (name === 'elysia' && chain[0] && chain[0].get === 't') { strip('t'); return { lib: 'typebox', chain }; }
  if (VALIBOT.has(name)) { strip('v'); strip('default'); return { lib: 'valibot', chain }; }
  if (VINE.has(name)) { strip('default'); strip('vine'); return { lib: 'vine', chain }; }
  if (EV.has(name)) { strip('default'); return { lib: 'ev', chain }; }
  return null;
}

const BUILDERS = { zod: zodBuild, joi: joiBuild, yup: yupBuild, typebox: typeboxBuild, valibot: valibotBuild, vine: vineBuild, ev: evBuild };
const METHODS = { zod: zodMethod, joi: joiMethod, yup: yupMethod, typebox: zodMethod, valibot: zodMethod, vine: vineMethod };

/** A call into a validation library: returns a schema value, or undefined. */
export function schemaPkgCall(interp, p) {
  const info = libOf(p);
  if (!info) return undefined;
  const { lib, chain } = info;
  // builder(name)(args) possibly followed by method calls already folded by the interpreter
  if (chain.length === 2 && 'get' in chain[0] && 'call' in chain[1]) {
    const z = BUILDERS[lib](interp, chain[0].get, chain[1].call);
    if (z) return z;
  }
  if (chain.length === 1 && 'call' in chain[0] && lib === 'joi') return base('joi', 'any');
  return undefined;
}

const VALIDATE = new Set(['parse', 'safeParse', 'parseAsync', 'safeParseAsync', 'spa', 'validate', 'validateAsync', 'validateSync',
  'assert', 'cast', 'check', 'Check', 'Decode', 'isValid', 'isValidSync', 'attempt']);

export function schemaMethod(interp, z, key, args) {
  if (VALIDATE.has(key)) return validateCall(interp, z, args);
  const m = METHODS[z.lib];
  if (!m) return z;
  if (z.lib === 'typebox' || z.lib === 'valibot') return z;
  return m(interp, z, key, args);
}

export function schemaGet(interp, z, key) {
  if (key === 'shape' || key === 'fields' || key === 'properties' || key === 'entries') {
    const o = { k: 'o', props: new Map((z.f.children || []).map((c) => [c.name, Z(z.lib, cloneField(c))])), id: 0 };
    return o;
  }
  if (key === 'element' && z.f.item) return Z(z.lib, cloneField(z.f.item));
  if (['parse', 'safeParse', 'parseAsync', 'safeParseAsync', 'validate', 'validateAsync', 'validateSync', 'assert', 'cast', 'check', 'Check', 'Decode'].includes(key)) {
    return { k: 'nf', name: key, impl: (args) => validateCall(interp, z, args) };
  }
  return undefined;
}

export function evMethodHook(interp, ev, key, args) {
  return evMethod(interp, ev, key, args);
}

/**
 * `schema.parse(req.body)` and friends: record the schema for the request part it validates.
 * Returns the request part so the result keeps being tracked.
 */
export function validateCall(interp, z, args) {
  const col = interp.analyzing;
  const target = args[0];
  if (col && target) {
    if (target.k === 'role' && target.role === 'field' && !target.path.length) {
      col.schemas.push({ loc: target.loc === 'form' || target.loc === 'input' ? 'body' : target.loc, value: z });
      return target;
    }
    if (target.k === 'role' && target.role === 'params') {
      col.schemas.push({ loc: 'params', value: z });
      return target;
    }
    if (target.k === 'o' && target.spreadRole && !target.props.size) {
      // schema.validate({ ...ctx.query })
      return validateCall(interp, z, [target.spreadRole, ...args.slice(1)]);
    }
    if (target.k === 'o') {
      // schema.parse({ body: req.body, query: req.query, params: req.params })
      let used = false;
      for (const [key, v] of target.props) {
        if (v.k !== 'role') continue;
        const loc = v.role === 'params' ? 'params' : v.loc;
        const child = (z.f.children || []).find((c) => c.name === key);
        if (child && loc) {
          col.schemas.push({ loc, value: Z(z.lib, child) });
          used = true;
        }
      }
      if (used) return U;
    }
  }
  return { k: 'u', name: 'validated' };
}

/** Convert any schema-like value to a Field (or null). */
export function toField(interp, v, name = '', lib = '') {
  if (!v) return null;
  if (v.k === 'z') {
    const f = cloneField(v.f);
    f.name = name;
    return f;
  }
  if (v.k === 'c' && interp && interp.hooks.classFields) {
    const fields = interp.hooks.classFields(interp, v);
    if (fields) return newField(name, 'object', { required: true, children: fields });
  }
  if (v.k === 'o') {
    const js = jsonSchemaOf(v);
    if (js && (js.type || js.properties || js.$ref || js.anyOf || js.oneOf || js.allOf || js.enum)) {
      const f = new SchemaReader(js).field(name, js, !(lib === 'joi' || lib === 'yup'));
      return f;
    }
    if (lib && v.props.size) {
      // a plain shape object inside a schema builder (joi.object({...}) keys without Joi)
      return newField(name, 'object', { required: true, children: shapeFields(interp, v, lib) });
    }
  }
  if (v.k === 's' && lib === 'typebox') return null;
  return null;
}

/** Object value -> JSON Schema, keeping nested schema values as {__field}. */
export function jsonSchemaOf(v, depth = 0) {
  if (!v || depth > 12) return undefined;
  switch (v.k) {
    case 's': case 'n': case 'b': return v.v;
    case 'null': return null;
    case 'a': return v.items.map((x) => jsonSchemaOf(x, depth + 1));
    case 'o': {
      const out = {};
      for (const [k, x] of v.props) out[k] = jsonSchemaOf(x, depth + 1);
      return out;
    }
    case 'z': return { __field: v.f };
    case 're': return v.source;
    default: return undefined;
  }
}

export function isSchema(v) {
  return v && (v.k === 'z' || (v.k === 'a' && v.items.some((x) => x.k === 'ev')) || v.k === 'ev');
}

export { pkgPath };
