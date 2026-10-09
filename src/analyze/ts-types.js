// TypeScript types and decorated DTO classes -> routeman fields.
// Handles interfaces, type aliases, enums, unions of literals, Partial/Pick/Omit, class-validator
// and @nestjs/swagger decorators, Nest mapped types (PartialType, PickType, OmitType, IntersectionType).
import { NONE, cloneField, field as newField } from '../model.js';
import { jsValue } from './values.js';

const MAX_DEPTH = 8;

/** Find a type/class declaration named `name` visible in module `rec` (follows imports and re-exports). */
export function findType(interp, rec, name, seen = new Set()) {
  if (!rec || seen.has(rec.file + '#' + name)) return null;
  seen.add(rec.file + '#' + name);
  if (rec.types.has(name)) return { rec, node: rec.types.get(name) };
  const imp = rec.imports.get(name) || rec.imports.get('\0export:' + name);
  if (imp) {
    const r = interp.resolveSpec(imp.source, rec.file);
    if (r && r.file) {
      const target = interp.parseOnly(r.file);
      if (target && target.ast) return findType(interp, target, imp.imported === 'default' ? defaultName(target) || name : imp.imported, seen);
    }
    return null;
  }
  // export * from './x'
  if (rec.ast) {
    for (const n of rec.ast.program.body) {
      if (n.type === 'ExportAllDeclaration' && n.source) {
        const r = interp.resolveSpec(n.source.value, rec.file);
        if (r && r.file) {
          const found = findType(interp, interp.parseOnly(r.file), name, seen);
          if (found) return found;
        }
      }
    }
  }
  return null;
}

function defaultName(rec) {
  for (const n of rec.ast.program.body) {
    if (n.type === 'ExportDefaultDeclaration') {
      const d = n.declaration;
      if (d.id) return d.id.name;
      if (d.type === 'Identifier') return d.name;
    }
  }
  return null;
}

function typeName(t) {
  if (!t) return '';
  if (t.type === 'Identifier') return t.name;
  if (t.type === 'TSQualifiedName') return typeName(t.left) + '.' + t.right.name;
  return '';
}

function literalValue(lit) {
  if (!lit) return undefined;
  if (lit.type === 'StringLiteral' || lit.type === 'NumericLiteral' || lit.type === 'BooleanLiteral') return lit.value;
  if (lit.type === 'UnaryExpression' && lit.operator === '-' && lit.argument.type === 'NumericLiteral') return -lit.argument.value;
  if (lit.type === 'TemplateLiteral' && !lit.expressions.length) return lit.quasis[0].value.cooked;
  return undefined;
}

function enumChoices(node) {
  const out = [];
  let next = 0;
  for (const m of node.members || (node.body && node.body.members) || []) {
    if (m.initializer) {
      const v = literalValue(m.initializer);
      if (v !== undefined) {
        out.push(v);
        if (typeof v === 'number') next = v + 1;
      }
    } else out.push(next++);
  }
  return out;
}

function typeArgs(t) {
  const p = t.typeParameters || t.typeArguments;
  return p ? p.params : [];
}

function typeOfChoice(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  if (typeof v === 'boolean') return 'boolean';
  return 'string';
}

/**
 * TS type annotation -> Field.
 * @param ctx {{ interp, rec, depth, seen: Set<string> }}
 */
export function typeToField(t, name, ctx) {
  const depth = ctx.depth || 0;
  if (!t || depth > MAX_DEPTH) return newField(name, 'any');
  if (t.type === 'TypeAnnotation' || t.type === 'TSTypeAnnotation') return typeToField(t.typeAnnotation, name, ctx);
  const next = { ...ctx, depth: depth + 1 };
  switch (t.type) {
    case 'TSStringKeyword': return newField(name, 'string');
    case 'TSNumberKeyword': return newField(name, 'number');
    case 'TSBigIntKeyword': return newField(name, 'integer');
    case 'TSBooleanKeyword': return newField(name, 'boolean');
    case 'TSAnyKeyword': case 'TSUnknownKeyword': case 'TSObjectKeyword': case 'TSNeverKeyword': return newField(name, t.type === 'TSObjectKeyword' ? 'object' : 'any');
    case 'TSNullKeyword': case 'TSUndefinedKeyword': case 'TSVoidKeyword': return newField(name, 'any', { isNull: true });
    case 'TSArrayType': return newField(name, 'array', { item: typeToField(t.elementType, name, next) });
    case 'TSTupleType': return newField(name, 'array', { item: t.elementTypes && t.elementTypes[0] ? typeToField(t.elementTypes[0].typeAnnotation || t.elementTypes[0], name, next) : null });
    case 'TSParenthesizedType': case 'TSOptionalType': case 'TSRestType': return typeToField(t.typeAnnotation, name, ctx);
    case 'TSTypeOperator': return typeToField(t.typeAnnotation, name, ctx);
    case 'TSLiteralType': {
      const v = literalValue(t.literal);
      return newField(name, typeOfChoice(v), { choices: v === undefined ? null : [v] });
    }
    case 'TSTemplateLiteralType': return newField(name, 'string');
    case 'TSUnionType': {
      const parts = t.types.map((x) => typeToField(x, name, next));
      const real = parts.filter((p) => !p.isNull);
      if (!real.length) return newField(name, 'any');
      if (real.every((p) => p.choices && p.choices.length)) {
        const f = newField(name, real[0].type, { choices: real.flatMap((p) => p.choices) });
        if (real.length < parts.length) f.optional = true;
        return f;
      }
      const f = cloneField(real[0]);
      f.name = name;
      if (real.length < parts.length) f.optional = true;
      return f;
    }
    case 'TSIntersectionType': {
      const children = [];
      for (const part of t.types) {
        const f = typeToField(part, name, next);
        for (const c of f.children || []) {
          const i = children.findIndex((x) => x.name === c.name);
          if (i >= 0) children[i] = c; else children.push(c);
        }
      }
      return newField(name, 'object', { children });
    }
    case 'TSTypeLiteral': return newField(name, 'object', { children: membersToFields(t.members, next) });
    case 'TSMappedType': return newField(name, 'object', { children: [] });
    case 'TSIndexedAccessType': return newField(name, 'any');
    case 'TSTypeReference': return referenceToField(t, name, next);
    case 'TSExpressionWithTypeArguments': case 'TSInterfaceHeritage': return referenceToField({ typeName: t.expression, typeParameters: t.typeParameters || t.typeArguments }, name, next);
    case 'TSTypeQuery': return newField(name, 'any');
    default: return newField(name, 'any');
  }
}

function referenceToField(t, name, ctx) {
  const n = typeName(t.typeName);
  const args = typeArgs(t);
  const last = n.split('.').pop();
  switch (last) {
    case 'Array': case 'ReadonlyArray': case 'Set': return newField(name, 'array', { item: args[0] ? typeToField(args[0], name, ctx) : null });
    case 'Promise': case 'Readonly': case 'NonNullable': case 'Awaited': case 'Required':
      if (args[0]) {
        const f = typeToField(args[0], name, ctx);
        if (last === 'Required' && f.children) f.children = f.children.map((c) => ({ ...c, required: true }));
        return f;
      }
      return newField(name, 'any');
    case 'Partial': case 'DeepPartial': {
      const f = args[0] ? typeToField(args[0], name, ctx) : newField(name, 'object');
      if (f.children) f.children = f.children.map((c) => ({ ...c, required: false }));
      return f;
    }
    case 'Pick': case 'Omit': {
      const f = args[0] ? typeToField(args[0], name, ctx) : newField(name, 'object');
      const keys = args[1] ? literalKeys(args[1]) : [];
      if (f.children) f.children = f.children.filter((c) => keys.includes(c.name) === (last === 'Pick'));
      return f;
    }
    case 'Record': case 'Map': case 'Object': return newField(name, 'object', { children: [] });
    case 'Date': return newField(name, 'datetime');
    case 'File': case 'Blob': case 'Buffer': case 'UploadedFile': case 'MultipartFile': return newField(name, 'file');
    case 'ObjectId': return newField(name, 'objectid');
    case 'String': return newField(name, 'string');
    case 'Number': return newField(name, 'number');
    case 'Boolean': return newField(name, 'boolean');
    default: break;
  }
  if (n === 'Express.Multer.File' || /Multer\.File$/.test(n)) return newField(name, 'file');
  if (n.includes('.')) {
    // z.infer<typeof schema>, Static<typeof T>, Namespace.Type
    return inferFromTypeof(t, args, name, ctx) || newField(name, 'any');
  }
  if (last === 'Infer' || last === 'Static' || last === 'InferType' || last === 'InferOutput' || last === 'InferInput' || last === 'Input' || last === 'Output') {
    return inferFromTypeof(t, args, name, ctx) || newField(name, 'any');
  }
  const ctxKey = `${ctx.rec && ctx.rec.file}#${n}`;
  if (ctx.seen && ctx.seen.has(ctxKey)) return newField(name, 'object', { children: [] });
  const found = findType(ctx.interp, ctx.rec, n);
  if (!found) return newField(name, 'any');
  const seen = new Set(ctx.seen || []);
  seen.add(ctxKey);
  return declToField(found.node, name, { ...ctx, rec: found.rec, seen });
}

/** z.infer<typeof Schema> / Static<typeof T>: evaluate the schema value in its module. */
function inferFromTypeof(t, args, name, ctx) {
  const q = args[0];
  if (!q || q.type !== 'TSTypeQuery') return null;
  const id = q.exprName;
  if (!id || id.type !== 'Identifier' || !ctx.rec || !ctx.rec.scope) return null;
  const v = ctx.interp.lookup(id.name, ctx.rec.scope);
  if (v && v.k === 'z') {
    const f = cloneField(v.f);
    f.name = name;
    return f;
  }
  return null;
}

function literalKeys(t) {
  if (t.type === 'TSLiteralType') return [literalValue(t.literal)];
  if (t.type === 'TSUnionType') return t.types.flatMap(literalKeys);
  return [];
}

export function declToField(node, name, ctx) {
  switch (node.type) {
    case 'TSInterfaceDeclaration': {
      const children = [];
      for (const ext of node.extends || []) {
        const parent = typeToField(ext, name, ctx);
        for (const c of parent.children || []) children.push(c);
      }
      for (const c of membersToFields(node.body.body, ctx)) {
        const i = children.findIndex((x) => x.name === c.name);
        if (i >= 0) children[i] = c; else children.push(c);
      }
      return newField(name, 'object', { children });
    }
    case 'TSTypeAliasDeclaration': return typeToField(node.typeAnnotation, name, ctx);
    case 'TSEnumDeclaration': {
      const choices = enumChoices(node);
      return newField(name, choices.length ? typeOfChoice(choices[0]) : 'string', { choices });
    }
    case 'ClassDeclaration': return newField(name, 'object', { children: classFields(node, ctx) });
    default: return newField(name, 'any');
  }
}

function membersToFields(members, ctx) {
  const out = [];
  for (const m of members || []) {
    if (m.type !== 'TSPropertySignature') continue;
    const key = m.key.type === 'Identifier' ? m.key.name : m.key.value;
    if (key == null) continue;
    const f = m.typeAnnotation ? typeToField(m.typeAnnotation, String(key), ctx) : newField(String(key), 'any');
    f.required = !m.optional && !f.optional;
    out.push(f);
  }
  return out;
}

// --- decorated classes (class-validator, @nestjs/swagger, TypeORM-free DTOs) -----------------

function decoratorName(d) {
  const e = d.expression;
  if (e.type === 'CallExpression') return typeName(e.callee) || (e.callee.property && e.callee.property.name) || '';
  return typeName(e) || (e.property && e.property.name) || '';
}

function decoratorArgs(d) {
  return d.expression.type === 'CallExpression' ? d.expression.arguments : [];
}

/** Evaluate a decorator argument (e.g. IsEnum(Role), ApiProperty({ example })) in the class's module. */
function evalArg(ctx, node) {
  if (!node || !ctx.rec || !ctx.rec.scope) return undefined;
  try {
    return ctx.interp.eval(node, ctx.rec.scope);
  } catch {
    return undefined;
  }
}

function enumValuesOf(v) {
  if (!v) return null;
  if (v.k === 'a') return v.items.map((x) => jsValue(x)).filter((x) => x !== undefined);
  if (v.k === 'o') {
    const vals = [...v.props.values()].map((x) => jsValue(x)).filter((x) => x !== undefined);
    const s = vals.filter((x) => typeof x === 'string');
    return s.length ? s : vals;
  }
  return null;
}

function nestedClassField(ctx, arrowNode, name) {
  // @Type(() => AddressDto)
  if (!arrowNode || arrowNode.type !== 'ArrowFunctionExpression') return null;
  const body = arrowNode.body;
  if (body.type !== 'Identifier') return null;
  const found = findType(ctx.interp, ctx.rec, body.name);
  if (!found) return null;
  return declToField(found.node, name, { ...ctx, rec: found.rec, depth: (ctx.depth || 0) + 1 });
}

function applyDecorators(f, decorators, ctx) {
  let optional = null;
  let nested = null;
  let isArray = f.type === 'array';
  for (const d of decorators || []) {
    const name = decoratorName(d);
    const args = decoratorArgs(d);
    const a0 = () => evalArg(ctx, args[0]);
    const num = () => { const v = a0(); return v && v.k === 'n' ? v.v : undefined; };
    switch (name) {
      case 'IsOptional': case 'ApiPropertyOptional': optional = true; break;
      case 'IsNotEmpty': case 'IsDefined': case 'ArrayNotEmpty': optional = optional === true && name !== 'IsDefined' ? true : false; break;
      case 'IsString': if (f.type === 'any') f.type = 'string'; break;
      case 'IsEmail': f.type = 'email'; break;
      case 'IsUrl': case 'IsURL': f.type = 'url'; break;
      case 'IsUUID': f.type = 'uuid'; break;
      case 'IsMongoId': f.type = 'objectid'; break;
      case 'IsInt': f.type = 'integer'; break;
      case 'IsNumber': case 'IsDecimal': case 'IsLatitude': case 'IsLongitude': if (f.type !== 'integer') f.type = 'number'; break;
      case 'IsPositive': if (!['integer', 'number'].includes(f.type)) f.type = 'number'; f.limits = { ...(f.limits || {}), exclusiveMin: 0 }; break;
      case 'IsNumberString': f.type = 'string'; f.example = '1'; break;
      case 'IsBoolean': case 'IsBooleanString': f.type = 'boolean'; break;
      case 'IsDate': f.type = 'datetime'; break;
      case 'IsDateString': case 'IsISO8601': f.type = 'datetime'; break;
      case 'IsMilitaryTime': f.type = 'time'; break;
      case 'IsPhoneNumber': case 'IsMobilePhone': f.example = '+919876543210'; break;
      case 'IsStrongPassword': f.example = 'Str0ngPassw0rd!'; break;
      case 'IsJWT': f.example = '{{access_token}}'; break;
      case 'IsHexColor': f.example = '#3366ff'; break;
      case 'IsIP': f.example = '127.0.0.1'; break;
      case 'IsPostalCode': f.example = '400001'; break;
      case 'IsArray': isArray = true; break;
      case 'IsObject': if (f.type === 'any') f.type = 'object'; break;
      case 'IsEnum': { const c = enumValuesOf(a0()); if (c && c.length) { f.choices = c; if (f.type === 'any') f.type = typeof c[0] === 'number' ? 'integer' : 'string'; } break; }
      case 'IsIn': { const c = enumValuesOf(a0()); if (c && c.length) f.choices = c; break; }
      case 'Equals': { const v = a0(); if (v && jsValue(v) !== undefined) f.choices = [jsValue(v)]; break; }
      case 'Min': f.limits = { ...(f.limits || {}), min: num() }; break;
      case 'Max': f.limits = { ...(f.limits || {}), max: num() }; break;
      case 'MinLength': f.limits = { ...(f.limits || {}), minLength: num() }; break;
      case 'MaxLength': f.limits = { ...(f.limits || {}), maxLength: num() }; break;
      case 'Length': {
        const lo = num();
        const hi = evalArg(ctx, args[1]);
        f.limits = { ...(f.limits || {}), minLength: lo, ...(hi && hi.k === 'n' ? { maxLength: hi.v } : {}) };
        break;
      }
      case 'ArrayMinSize': f.limits = { ...(f.limits || {}), minItems: num() }; isArray = true; break;
      case 'Matches': { const v = a0(); if (v && v.k === 're') f.limits = { ...(f.limits || {}), pattern: v.source }; break; }
      case 'Type': nested = nestedClassField(ctx, args[0], f.name); break;
      case 'PrimaryGeneratedColumn': case 'PrimaryColumn': case 'CreateDateColumn': case 'UpdateDateColumn': case 'DeleteDateColumn':
      case 'VersionColumn': case 'OneToMany': case 'ManyToMany': case 'ManyToOne': case 'OneToOne': case 'JoinColumn': case 'JoinTable':
      case 'PrimaryKey': case 'SerializedPrimaryKey': case 'Exclude': case 'HideField': case 'ApiHideProperty': case 'Expose_never':
        f.exclude = true; break;
      case 'Column': case 'prop': case 'Prop': {
        const v = a0();
        if (v && v.k === 'o') {
          const o = jsValue(v);
          if (o.nullable === true || o.default !== undefined) optional = true;
          if (o.required === true) optional = false;
          if (o.default !== undefined && typeof o.default !== 'object') f.default = o.default;
          const en = enumValuesOf(v.props.get('enum'));
          if (en && en.length) f.choices = en;
          if (o.type === 'uuid') f.type = 'uuid';
        } else if (name === 'prop' || name === 'Prop') optional = optional === null ? true : optional;
        break;
      }
      case 'ApiProperty': case 'ApiModelProperty': case 'Field': case 'Property': case 'property': {
        const v = a0();
        if (v && v.k === 'o') {
          const o = jsValue(v);
          if (o.example !== undefined) f.example = o.example;
          if (o.default !== undefined) f.default = o.default;
          if (o.description) f.description = o.description;
          if (o.required === false) optional = true;
          if (o.required === true) optional = false;
          if (o.minimum !== undefined) f.limits = { ...(f.limits || {}), min: o.minimum };
          if (o.maximum !== undefined) f.limits = { ...(f.limits || {}), max: o.maximum };
          if (o.minLength !== undefined) f.limits = { ...(f.limits || {}), minLength: o.minLength };
          if (o.maxLength !== undefined) f.limits = { ...(f.limits || {}), maxLength: o.maxLength };
          if (o.format === 'binary') f.type = 'file';
          if (o.format === 'email') f.type = 'email';
          if (o.isArray) isArray = true;
          const en = enumValuesOf(v.props.get('enum'));
          if (en && en.length) f.choices = en;
          if (o.type && typeof o.type === 'string' && f.type === 'any') f.type = { string: 'string', number: 'number', integer: 'integer', boolean: 'boolean' }[o.type] || f.type;
        }
        break;
      }
      default: break;
    }
  }
  if (nested) {
    if (isArray || f.type === 'array') return { ...f, type: 'array', item: { ...nested, name: f.name }, optional };
    return { ...nested, name: f.name, description: f.description || nested.description, optional };
  }
  if (isArray && f.type !== 'array') {
    const item = { ...cloneField(f), name: f.name };
    return { ...newField(f.name, 'array', { item, description: f.description }), optional, limits: f.limits && f.limits.minItems ? { minItems: f.limits.minItems } : undefined };
  }
  return { ...f, optional };
}

/** Fields of a DTO class: its properties, their decorators, its base class and mapped types. */
export function classFields(node, ctx) {
  const out = [];
  const add = (list) => {
    for (const c of list) {
      const i = out.findIndex((x) => x.name === c.name);
      if (i >= 0) out[i] = c; else out.push(c);
    }
  };
  if (node.superClass) add(superFields(node.superClass, ctx));
  for (const m of node.body.body) {
    if (m.type !== 'ClassProperty' || m.static) continue;
    const key = m.key.type === 'Identifier' ? m.key.name : m.key.value;
    if (key == null) continue;
    let f = m.typeAnnotation ? typeToField(m.typeAnnotation, String(key), ctx) : newField(String(key), 'any');
    f.name = String(key);
    if (m.value) {
      const v = evalArg(ctx, m.value);
      if (v && (v.k === 's' || v.k === 'n' || v.k === 'b')) f.default = v.v;
    }
    const typeOptional = !!f.optional;
    f = applyDecorators(f, m.decorators, ctx);
    const decided = f.optional;
    f.required = decided === null || decided === undefined ? !(m.optional || typeOptional) : !decided;
    if (f.default !== NONE && decided !== false) f.required = false;
    delete f.optional;
    out.push(f);
  }
  return out;
}

function superFields(expr, ctx) {
  if (expr.type === 'Identifier') {
    const found = findType(ctx.interp, ctx.rec, expr.name);
    if (found && found.node.type === 'ClassDeclaration') return classFields(found.node, { ...ctx, rec: found.rec, depth: (ctx.depth || 0) + 1 });
    return [];
  }
  if (expr.type === 'CallExpression') {
    const callee = typeName(expr.callee) || (expr.callee.property && expr.callee.property.name) || '';
    const args = expr.arguments;
    const of = (a) => (a ? superFields(a, ctx) : []);
    switch (callee) {
      case 'PartialType': return of(args[0]).map((f) => ({ ...f, required: false }));
      case 'PickType': case 'OmitType': {
        const keys = keyList(args[1], ctx);
        return of(args[0]).filter((f) => keys.includes(f.name) === (callee === 'PickType'));
      }
      case 'IntersectionType': return args.flatMap((a) => of(a));
      case 'createZodDto': case 'createDto': {
        const v = evalArg(ctx, args[0]);
        if (v && v.k === 'z') return (v.f.children || []).map(cloneField);
        return [];
      }
      default: {
        const v = evalArg(ctx, expr);
        if (v && v.k === 'z') return (v.f.children || []).map(cloneField);
        return [];
      }
    }
  }
  return [];
}

function keyList(node, ctx) {
  if (!node) return [];
  let n = node;
  while (n.type === 'TSAsExpression' || n.type === 'TSSatisfiesExpression') n = n.expression;
  if (n.type === 'ArrayExpression') return n.elements.filter((e) => e && e.type === 'StringLiteral').map((e) => e.value);
  const v = evalArg(ctx, n);
  return v && v.k === 'a' ? v.items.filter((x) => x.k === 's').map((x) => x.v) : [];
}

/** Fields for an interpreter class value (used by toField for plainToInstance(Dto, req.body), etc). */
export function classValueFields(interp, c) {
  const rec = c.mod || null;
  if (!c.node) return null;
  return classFields(c.node, { interp, rec, depth: 0, seen: new Set() });
}
