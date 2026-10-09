// ORM models -> body fields, for handlers that pass the request body straight to the database:
//   Model.create(req.body), new Model(req.body), prisma.user.create({ data: req.body }),
//   repository.save(req.body), User.update(req.body, ...).
// Supports Mongoose schemas, Prisma (schema.prisma), Sequelize (define / Model.init) and
// TypeORM / Typegoose / MikroORM entity classes.
import fs from 'node:fs';
import path from 'node:path';
import { field as newField } from '../model.js';
import { jsValue, pkgPath, obj, UNDEF } from './values.js';
import { classFields } from './ts-types.js';

const SKIP = /^(_id|__v|id|createdAt|updatedAt|deletedAt|created_at|updated_at|deleted_at|version)$/;
const WRITE_METHODS = new Set(['create', 'insert', 'insertMany', 'save', 'update', 'updateOne', 'findByIdAndUpdate', 'findOneAndUpdate',
  'replaceOne', 'upsert', 'bulkCreate', 'build', 'merge', 'preload', 'createMany', 'updateMany', 'set', 'assign', 'make', 'fill', 'persist', 'insertOne']);

// --- recording -------------------------------------------------------------------------------

function bodyArg(args) {
  for (const a of args) {
    if (!a) continue;
    if (a.k === 'role' && a.role === 'field' && !a.path.length && (a.loc === 'body' || a.loc === 'form' || a.loc === 'input')) return a;
    if (a.k === 'o') {
      for (const key of ['data', 'values', 'update', 'create', '$set']) {
        const v = a.props.get(key);
        if (v && v.k === 'role' && v.role === 'field' && !v.path.length) return v;
      }
      if (a.spreadRole && !a.spreadRole.path.length) return a.spreadRole;
    }
  }
  return null;
}

export function recordOrm(interp, model, args, method) {
  const col = interp.analyzing;
  if (!col || !model) return;
  if (method && !WRITE_METHODS.has(method)) return;
  if (!bodyArg(args)) return;
  col.ormModels = col.ormModels || [];
  col.ormModels.push(model);
}

/** Package calls that create models (mongoose.model, sequelize.define, new Schema, getRepository). */
export function ormPkgCall(interp, p, args, isNew) {
  const name = p.pkg;
  const sig = pkgPath(p).replace(/^default\./, '');
  if (name === 'mongoose') {
    if (/(^|\.)Schema\(\)$/.test(sig) && args[0] && args[0].k === 'o') return obj([], { ormSchema: { kind: 'mongoose', def: args[0] } });
    if (/(^|\.)model\(\)$/.test(sig)) {
      const schema = args[1];
      if (schema && schema.ormSchema) return obj([], { ormModel: schema.ormSchema, modelName: args[0] && args[0].v });
      if (schema && schema.k === 'o') return obj([], { ormModel: { kind: 'mongoose', def: schema }, modelName: args[0] && args[0].v });
    }
    return undefined;
  }
  if (name === '@typegoose/typegoose' && /getModelForClass\(\)$/.test(sig) && args[0] && args[0].k === 'c') {
    return obj([], { ormModel: { kind: 'class', cls: args[0] } });
  }
  if (name === 'sequelize' || name === '@sequelize/core') {
    if (/define\(\)$/.test(sig) && args[1] && args[1].k === 'o') return obj([], { ormModel: { kind: 'sequelize', attrs: args[1] } });
    return undefined;
  }
  if (name === 'typeorm' || name === '@mikro-orm/core') {
    if (/(getRepository|getMongoRepository|getTreeRepository|getCustomRepository)\(\)$/.test(sig) && args[0] && args[0].k === 'c') {
      return obj([], { ormModel: { kind: 'class', cls: args[0] }, repository: true });
    }
    return undefined;
  }
  if (name === '@prisma/client' || /prisma/.test(name)) {
    // prisma.user.create({ data: req.body })
    const gets = p.chain.filter((c) => 'get' in c).map((c) => c.get);
    const method = gets[gets.length - 1];
    const model = gets[gets.length - 2];
    if (interp.analyzing && model && WRITE_METHODS.has(method)) recordOrm(interp, { kind: 'prisma', model }, args, method);
    return undefined;
  }
  void isNew;
  return undefined;
}

/** Calls on model values: User.create(req.body), new User(req.body), repo.save(req.body). */
export function ormObjectCall(interp, o, key, args, isNew) {
  if (!interp.analyzing || !o) return;
  if (o.k === 'o' && o.ormModel) {
    if (isNew || WRITE_METHODS.has(key)) recordOrm(interp, o.ormModel, args, isNew ? null : key);
    return;
  }
  if (o.k === 'c') {
    const base = o.superVal;
    const ormBase = base && base.k === 'p' && /^(sequelize|@sequelize\/core|typeorm|objection|@mikro-orm\/core|sequelize-typescript)$/.test(base.pkg);
    if (o.ormAttrs || ormBase || o.typegoose) {
      if (isNew || WRITE_METHODS.has(key)) recordOrm(interp, o.ormAttrs ? { kind: 'sequelize', attrs: o.ormAttrs } : { kind: 'class', cls: o }, args, isNew ? null : key);
    }
  }
}

/** Sequelize `class User extends Model {}; User.init({...})`. */
export function ormStaticInit(o, key, args) {
  if (o && o.k === 'c' && key === 'init' && args[0] && args[0].k === 'o') o.ormAttrs = args[0];
}

// --- model -> fields -------------------------------------------------------------------------

export function modelFields(interp, model) {
  try {
    switch (model.kind) {
      case 'mongoose': return mongooseFields(model.def, 0);
      case 'sequelize': return sequelizeFields(model.attrs);
      case 'prisma': return prismaFields(interp, model.model);
      case 'class': return entityFields(interp, model.cls);
      default: return null;
    }
  } catch (err) {
    if (process.env.ROUTEMAN_DEBUG) throw err;
    return null;
  }
}

function typeName(v) {
  if (!v) return '';
  if (v.k === 'p') return pkgPath(v).split('.').pop().replace(/\(\)$/, '');
  if (v.k === 'u') return String(v.name).split('.').pop();
  if (v.k === 's') return v.v;
  if (v.k === 'c') return v.name;
  return '';
}

const MONGOOSE_TYPES = { String: 'string', Number: 'number', Boolean: 'boolean', Date: 'datetime', ObjectId: 'objectid', Decimal128: 'number',
  Buffer: 'string', Mixed: 'object', Map: 'object', UUID: 'uuid', BigInt: 'integer', Int32: 'integer', Double: 'number', string: 'string', number: 'number', boolean: 'boolean', date: 'datetime' };

function mongooseFields(def, depth) {
  if (!def || def.k !== 'o' || depth > 4) return [];
  const out = [];
  for (const [key, spec] of def.props) {
    if (SKIP.test(key)) continue;
    const f = mongooseField(key, spec, depth);
    if (f) out.push(f);
  }
  return out;
}

function mongooseField(name, spec, depth) {
  if (!spec) return null;
  if (spec.k === 'a') {
    const item = spec.items[0] ? mongooseField(name, spec.items[0], depth + 1) : newField(name, 'string');
    return newField(name, 'array', { item });
  }
  if (spec.k === 'o' && spec.ormSchema) return newField(name, 'object', { children: mongooseFields(spec.ormSchema.def, depth + 1) });
  if (spec.k === 'o' && !spec.props.has('type')) return newField(name, 'object', { children: mongooseFields(spec, depth + 1) });
  if (spec.k === 'o') {
    const t = spec.props.get('type');
    const f = t && t.k === 'a' ? mongooseField(name, t, depth) : newField(name, MONGOOSE_TYPES[typeName(t)] || 'string');
    const o = jsValue(spec) || {};
    const req = spec.props.get('required');
    f.required = !!(req && ((req.k === 'b' && req.v) || (req.k === 'a' && req.items[0] && req.items[0].v === true)));
    const en = spec.props.get('enum');
    const values = en && en.k === 'a' ? en.items.map(jsValue) : en && en.k === 'o' && en.props.get('values') ? jsValue(en.props.get('values')) : en && en.k === 'o' ? [...en.props.values()].map(jsValue) : null;
    if (values && values.length) f.choices = values.filter((x) => x !== undefined && x !== null);
    if (o.default !== undefined && typeof o.default !== 'object') { f.default = o.default; f.required = false; }
    const lim = {};
    if (typeof o.min === 'number') lim.min = o.min;
    if (typeof o.max === 'number') lim.max = o.max;
    if (typeof o.minlength === 'number' || typeof o.minLength === 'number') lim.minLength = o.minlength ?? o.minLength;
    if (typeof o.maxlength === 'number' || typeof o.maxLength === 'number') lim.maxLength = o.maxlength ?? o.maxLength;
    if (Object.keys(lim).length) f.limits = lim;
    if (o.select === false && /password/i.test(name)) f.required = true;
    if (o.immutable || o.auto) return null;
    return f;
  }
  return newField(name, MONGOOSE_TYPES[typeName(spec)] || 'string');
}

const SEQ_TYPES = { STRING: 'string', TEXT: 'string', CHAR: 'string', CITEXT: 'string', UUID: 'uuid', UUIDV4: 'uuid', INTEGER: 'integer', BIGINT: 'integer',
  SMALLINT: 'integer', TINYINT: 'integer', MEDIUMINT: 'integer', FLOAT: 'number', DOUBLE: 'number', REAL: 'number', DECIMAL: 'number',
  BOOLEAN: 'boolean', DATE: 'datetime', DATEONLY: 'date', TIME: 'time', JSON: 'object', JSONB: 'object', ARRAY: 'array', ENUM: 'string', INET: 'string' };

function sequelizeFields(attrs) {
  if (!attrs || attrs.k !== 'o') return [];
  const out = [];
  for (const [key, spec] of attrs.props) {
    if (SKIP.test(key)) continue;
    let typeV = spec;
    let opts = null;
    if (spec.k === 'o' && spec.props.has('type')) { typeV = spec.props.get('type'); opts = spec; }
    const tname = typeName(typeV).toUpperCase();
    const f = newField(key, SEQ_TYPES[tname] || 'string');
    if (typeV && typeV.k === 'p') {
      const calls = typeV.chain.filter((c) => 'call' in c);
      if (tname === 'ENUM' && calls.length) f.choices = calls[0].call.map(jsValue).filter((x) => typeof x === 'string');
    }
    if (opts) {
      const o = jsValue(opts) || {};
      if (o.primaryKey || o.autoIncrement) continue;
      f.required = o.allowNull === false && o.defaultValue === undefined;
      if (o.defaultValue !== undefined && typeof o.defaultValue !== 'object') f.default = o.defaultValue;
      const validate = o.validate || {};
      if (validate.isEmail) f.type = 'email';
      if (validate.isUrl) f.type = 'url';
      if (Array.isArray(validate.isIn) && Array.isArray(validate.isIn[0])) f.choices = validate.isIn[0];
      const values = opts.props.get('values');
      if (values && values.k === 'a') f.choices = values.items.map(jsValue);
    }
    out.push(f);
  }
  return out;
}

// --- Prisma ----------------------------------------------------------------------------------

const PRISMA_TYPES = { String: 'string', Int: 'integer', BigInt: 'integer', Float: 'number', Decimal: 'number', Boolean: 'boolean', DateTime: 'datetime', Json: 'object', Bytes: 'string' };

function loadPrisma(interp) {
  if (interp.state.prisma !== undefined) return interp.state.prisma;
  let text = '';
  const candidates = ['prisma/schema.prisma', 'schema.prisma', 'src/prisma/schema.prisma', 'prisma/schema'];
  for (const c of candidates) {
    const p = path.join(interp.root, c);
    try {
      if (fs.statSync(p).isDirectory()) {
        for (const f of fs.readdirSync(p)) if (f.endsWith('.prisma')) text += fs.readFileSync(path.join(p, f), 'utf8') + '\n';
      } else text += fs.readFileSync(p, 'utf8');
      if (text) break;
    } catch { /* next */ }
  }
  const models = new Map();
  const enums = new Map();
  const blockRe = /^\s*(model|enum|type)\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm;
  let m;
  while ((m = blockRe.exec(text))) {
    const [, kind, name, bodyText] = m;
    const lines = bodyText.split('\n').map((l) => l.replace(/\/\/.*$/, '').trim()).filter((l) => l && !l.startsWith('@@'));
    if (kind === 'enum') enums.set(name, lines.map((l) => l.split(/\s+/)[0]));
    else models.set(name, lines.map((l) => {
      const [fname, ftype = '', ...attrs] = l.split(/\s+/);
      return { name: fname, type: ftype, attrs: attrs.join(' ') };
    }));
  }
  interp.state.prisma = { models, enums };
  return interp.state.prisma;
}

function prismaFields(interp, clientName) {
  const { models, enums } = loadPrisma(interp);
  const modelName = [...models.keys()].find((k) => k.toLowerCase() === String(clientName).toLowerCase());
  if (!modelName) return null;
  return prismaModel(models, enums, modelName, 0);
}

function prismaModel(models, enums, name, depth) {
  const out = [];
  for (const fdef of models.get(name) || []) {
    const base = fdef.type.replace(/[?[\]!]/g, '');
    const optional = fdef.type.endsWith('?');
    const list = fdef.type.endsWith('[]');
    const a = fdef.attrs;
    if (/@relation|@updatedAt/.test(a) || /@default\((now|autoincrement|uuid|cuid|dbgenerated|ulid|nanoid)\(/.test(a) || /@id\b/.test(a) && /@default/.test(a)) continue;
    if (models.has(base) && !/^type$/.test(base)) continue; // relation field
    let f;
    if (enums.has(base)) f = newField(fdef.name, 'string', { choices: enums.get(base) });
    else f = newField(fdef.name, PRISMA_TYPES[base] || 'string');
    if (list) f = newField(fdef.name, 'array', { item: f });
    const dm = /@default\(([^)]*)\)/.exec(a);
    if (dm) {
      const raw = dm[1].trim();
      f.default = /^".*"$/.test(raw) ? raw.slice(1, -1) : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw === 'true' ? true : raw === 'false' ? false : raw;
    }
    f.required = !optional && !dm && !list;
    void depth;
    out.push(f);
  }
  return out;
}

// --- TypeORM / MikroORM / Typegoose entity classes -------------------------------------------

function entityFields(interp, cls) {
  if (!cls || !cls.node) return null;
  const fields = classFields(cls.node, { interp, rec: cls.mod, depth: 0, seen: new Set() });
  return fields.filter((f) => !f.exclude && !SKIP.test(f.name));
}

export { UNDEF };
