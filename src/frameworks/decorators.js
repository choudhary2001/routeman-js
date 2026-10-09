// Decorator-based frameworks: NestJS, routing-controllers, tsoa, inversify-express-utils, LoopBack 4.
import fs from 'node:fs';
import path from 'node:path';
import { field as newField, route as newRoute, cloneField } from '../model.js';
import { joinPath } from '../naming.js';
import { Collector, role, authName } from '../analyze/roles.js';
import { buildRequest, runBudget, normalizePath, commentText, parseDoc, routeName } from '../analyze/routes.js';
import { typeToField } from '../analyze/ts-types.js';
import { U, UNDEF, obj, native, jsValue, pkgPath, str } from '../analyze/values.js';
import { findEntries } from '../project.js';

const LIBS = {
  '@nestjs/common': 'nest',
  'routing-controllers': 'rc',
  tsoa: 'tsoa',
  '@tsoa/runtime': 'tsoa',
  'inversify-express-utils': 'inversify',
  '@loopback/rest': 'loopback',
  '@loopback/core': 'loopback',
  '@loopback/openapi-v3': 'loopback',
};

const CLASS_DECORATORS = {
  nest: ['Controller'],
  rc: ['JsonController', 'Controller'],
  tsoa: ['Route'],
  inversify: ['controller'],
  loopback: ['api'],
};

const METHOD_DECORATORS = {
  nest: { Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH', Delete: 'DELETE', Options: 'OPTIONS', Head: 'HEAD', All: 'ALL', Search: 'SEARCH', Sse: 'GET' },
  rc: { Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH', Delete: 'DELETE', Head: 'HEAD', All: 'ALL' },
  tsoa: { Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH', Delete: 'DELETE', Head: 'HEAD', Options: 'OPTIONS' },
  inversify: { httpGet: 'GET', httpPost: 'POST', httpPut: 'PUT', httpPatch: 'PATCH', httpDelete: 'DELETE', httpHead: 'HEAD', all: 'ALL' },
  loopback: { get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH', del: 'DELETE', operation: null },
};

const PUBLIC_NAME = /^(Public|IsPublic|PublicRoute|SkipAuth|AllowAnonymous|Anonymous|NoAuth|Unprotected|SkipJwt|OptionalAuth|NoSecurity|AuthSkip|SkipAuthentication|AllowUnauthenticated)$/i;

function decName(d) {
  let e = d.expression;
  if (e.type === 'CallExpression') e = e.callee;
  if (e.type === 'Identifier') return e.name;
  if (e.type === 'MemberExpression') return memberPath(e);
  return '';
}

function memberPath(e) {
  if (e.type === 'Identifier') return e.name;
  if (e.type === 'MemberExpression') return memberPath(e.object) + '.' + (e.property.name || '');
  if (e.type === 'CallExpression') return memberPath(e.callee);
  return '';
}

function decArgs(d) {
  return d.expression.type === 'CallExpression' ? d.expression.arguments : [];
}

function evalIn(interp, rec, node) {
  if (!node || !rec || !rec.scope) return U;
  try {
    return interp.eval(node, rec.scope);
  } catch {
    return U;
  }
}

function libOf(rec, name) {
  const base = name.split('.')[0];
  const imp = rec.imports.get(base);
  if (!imp) return null;
  return LIBS[imp.source] || null;
}

function pathsOf(v) {
  if (!v) return [''];
  if (v.k === 's') return [v.v];
  if (v.k === 'a') return v.items.filter((x) => x.k === 's').map((x) => x.v);
  if (v.k === 'o') {
    const p = v.props.get('path');
    return pathsOf(p);
  }
  return [''];
}

// --- Nest application settings (main.ts) ---------------------------------------------------

function nestApp(interp) {
  const st = interp.state.nest;
  const self = obj();
  const chain = (name, impl) => native(name, (args) => { if (impl) impl(args); return self; });
  self.props.set('setGlobalPrefix', chain('setGlobalPrefix', (args) => {
    if (args[0] && args[0].k === 's') st.prefix = args[0].v;
    const opts = args[1];
    const ex = opts && opts.k === 'o' ? opts.props.get('exclude') : null;
    if (ex && ex.k === 'a') st.exclude = ex.items.map((x) => (x.k === 's' ? x.v : x.k === 'o' && x.props.get('path') ? x.props.get('path').v : null)).filter(Boolean);
  }));
  self.props.set('enableVersioning', chain('enableVersioning', (args) => {
    const o = args[0] && args[0].k === 'o' ? jsValue(args[0]) : {};
    st.versioning = { type: o.type, defaultVersion: o.defaultVersion, prefix: o.prefix === undefined ? 'v' : o.prefix };
  }));
  self.props.set('useGlobalGuards', chain('useGlobalGuards', (args) => {
    for (const a of args) {
      const n = a.k === 'o' && a.cls ? a.cls.name : a.name || '';
      if (authName(n) || /guard/i.test(n)) st.globalGuard = n || 'GlobalGuard';
    }
  }));
  self.props.set('listen', native('listen', (args) => {
    const p = args[0];
    if (p && p.k === 'n') interp.ports.push(p.v);
    else if (p && p.k === 's' && /^\d+$/.test(p.v)) interp.ports.push(Number(p.v));
    return U;
  }));
  for (const m of ['use', 'enableCors', 'useGlobalPipes', 'useGlobalInterceptors', 'useGlobalFilters', 'setViewEngine', 'useStaticAssets', 'enableShutdownHooks', 'init', 'useWebSocketAdapter', 'connectMicroservice', 'startAllMicroservices', 'setBaseViewsDir', 'useLogger', 'register']) {
    self.props.set(m, chain(m));
  }
  self.props.set('get', native('get', () => U));
  self.props.set('getHttpAdapter', native('getHttpAdapter', () => U));
  return self;
}

function nestPkgHooks(interp) {
  const prev = interp.hooks.pkgCall;
  interp.hooks.pkgCall = (i, p, args, isNew, node) => {
    if (p.pkg === '@nestjs/core' && /NestFactory\.create\(\)$/.test(pkgPath(p))) return nestApp(i);
    if (p.pkg === '@nestjs/swagger' && /addBearerAuth\(\)$/.test(pkgPath(p))) i.state.nest.swaggerBearer = true;
    if (p.pkg === 'routing-controllers' && /^(use|create)(Express|Koa)Server\(\)$/.test(pkgPath(p))) {
      const opts = args.find((a) => a && a.k === 'o');
      const prefix = opts && opts.props.get('routePrefix');
      if (prefix && prefix.k === 's') i.state.nest.rcPrefix = prefix.v;
      if (opts && opts.props.get('authorizationChecker')) i.state.nest.rcAuth = true;
      return undefined;
    }
    return prev(i, p, args, isNew, node);
  };
}

// --- module graph (RouterModule prefixes, APP_GUARD) -----------------------------------------

function scanModules(interp, recs) {
  const st = interp.state.nest;
  st.modulePrefix = st.modulePrefix || new Map();     // module class name -> prefix
  st.controllerModule = st.controllerModule || new Map(); // controller class name -> module name
  for (const rec of recs) {
    for (const cls of rec.classes.values()) {
      const dec = (cls.decorators || []).find((d) => decName(d) === 'Module');
      if (!dec) continue;
      const meta = decArgs(dec)[0];
      if (!meta || meta.type !== 'ObjectExpression') continue;
      for (const p of meta.properties) {
        const key = p.key && (p.key.name || p.key.value);
        if (key === 'controllers' && p.value.type === 'ArrayExpression') {
          for (const el of p.value.elements) if (el && el.type === 'Identifier') st.controllerModule.set(el.name, cls.id.name);
        }
        if (key === 'providers' && p.value.type === 'ArrayExpression') {
          for (const el of p.value.elements) {
            if (!el || el.type !== 'ObjectExpression') continue;
            const prov = el.properties.find((x) => x.key && (x.key.name === 'provide'));
            const use = el.properties.find((x) => x.key && (x.key.name === 'useClass' || x.key.name === 'useExisting'));
            if (prov && prov.value.type === 'Identifier' && prov.value.name === 'APP_GUARD' && use && use.value.type === 'Identifier') {
              const n = use.value.name;
              if (authName(n) && !/throttl|rate/i.test(n)) st.globalGuard = n;
            }
          }
        }
        if (key === 'imports' && p.value.type === 'ArrayExpression') {
          for (const el of p.value.elements) {
            if (el && el.type === 'CallExpression' && memberPath(el.callee) === 'RouterModule.register' && el.arguments[0]) {
              const routes = jsRoutes(el.arguments[0]);
              const walk = (list, prefix) => {
                for (const r of list) {
                  const full = joinPath(prefix, r.path || '');
                  if (r.module) st.modulePrefix.set(r.module, full);
                  if (r.children) walk(r.children, full);
                }
              };
              walk(routes, '');
            }
          }
        }
      }
    }
  }
}

function jsRoutes(node) {
  if (!node || node.type !== 'ArrayExpression') return [];
  return node.elements.filter((e) => e && e.type === 'ObjectExpression').map((e) => {
    const out = {};
    for (const p of e.properties) {
      const key = p.key && (p.key.name || p.key.value);
      if (key === 'path' && p.value.type === 'StringLiteral') out.path = p.value.value;
      if (key === 'module' && p.value.type === 'Identifier') out.module = p.value.name;
      if (key === 'children') out.children = jsRoutes(p.value);
    }
    return out;
  });
}

// --- controllers -----------------------------------------------------------------------------

function isPublicDecorator(interp, rec, d) {
  const name = decName(d);
  if (PUBLIC_NAME.test(name)) return true;
  if (name === 'SetMetadata') {
    const k = decArgs(d)[0];
    const v = evalIn(interp, rec, k);
    return v.k === 's' && /public|skip|anonymous|no.?auth/i.test(v.v);
  }
  if (name === 'authenticate.skip') return true;
  // custom decorator: export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)
  const v = evalIn(interp, rec, { type: 'Identifier', name: name.split('.')[0] });
  if (v && v.k === 'f' && v.node) {
    const src = rec.ast && rec.ast.__code ? '' : '';
    void src;
    const body = JSON.stringify(v.node.body, (k, val) => (k === 'loc' || k === 'start' || k === 'end' || k === 'leadingComments' || k === 'trailingComments' ? undefined : val));
    return /SetMetadata/.test(body) && /public|skip|anonymous|noauth/i.test(body);
  }
  return false;
}

function guardInfo(interp, rec, decorators, lib) {
  let protect = null;
  let kind = null;
  let login = false;
  for (const d of decorators || []) {
    const name = decName(d);
    const args = decArgs(d);
    if (isPublicDecorator(interp, rec, d)) { protect = false; continue; }
    if ((lib === 'nest' && name === 'UseGuards') || (lib === 'rc' && name === 'UseBefore') || (lib === 'inversify' && false)) {
      for (const a of args) {
        const n = a.type === 'CallExpression' ? memberPath(a.callee) : a.type === 'NewExpression' ? memberPath(a.callee) : memberPath(a);
        let strategy = '';
        if (a.type === 'CallExpression' && /AuthGuard$/.test(n) && a.arguments[0]) {
          const v = evalIn(interp, rec, a.arguments[0]);
          strategy = v.k === 's' ? v.v : v.k === 'a' && v.items[0] && v.items[0].k === 's' ? v.items[0].v : '';
        }
        if (strategy === 'local') { login = true; continue; }
        if (/google|github|facebook|oauth|microsoft|apple|twitter|linkedin/i.test(strategy)) continue;
        if (authName(n) || /auth/i.test(strategy)) {
          protect = protect === false ? false : true;
          if (/api.?key|headerapikey/i.test(strategy + n)) kind = 'apikey';
          else if (/basic/i.test(strategy + n)) kind = 'basic';
          else if (/session|cookie/i.test(strategy + n)) kind = 'session';
          else kind = kind || 'bearer';
        }
      }
    }
    if (lib === 'rc' && (name === 'Authorized')) protect = protect === false ? false : true;
    if (lib === 'tsoa' && name === 'Security') {
      protect = true;
      const v = evalIn(interp, rec, args[0]);
      const s = v.k === 's' ? v.v : '';
      kind = /api.?key/i.test(s) ? 'apikey' : /basic/i.test(s) ? 'basic' : 'bearer';
    }
    if (lib === 'tsoa' && name === 'NoSecurity') protect = false;
    if (lib === 'loopback' && name === 'authenticate') {
      protect = true;
      const v = evalIn(interp, rec, args[0]);
      if (v.k === 's' && /basic/.test(v.v)) kind = 'basic';
      else kind = 'bearer';
    }
  }
  return { protect, kind, login };
}

function interceptorFiles(interp, rec, decorators) {
  const files = [];
  for (const d of decorators || []) {
    if (decName(d) !== 'UseInterceptors') continue;
    for (const a of decArgs(d)) {
      if (a.type !== 'CallExpression') continue;
      const n = memberPath(a.callee);
      const v0 = evalIn(interp, rec, a.arguments[0]);
      if (n === 'FileInterceptor' && v0.k === 's') files.push({ name: v0.v, many: false });
      else if (n === 'FilesInterceptor' && v0.k === 's') files.push({ name: v0.v, many: true });
      else if (n === 'FileFieldsInterceptor' && v0.k === 'a') {
        for (const it of v0.items) {
          const nm = it.k === 'o' ? it.props.get('name') : null;
          if (nm && nm.k === 's') files.push({ name: nm.v, many: true });
        }
      } else if (n === 'AnyFilesInterceptor') files.push({ name: 'files', many: true });
    }
  }
  return files;
}

const PIPE_TYPES = { ParseIntPipe: 'integer', ParseFloatPipe: 'number', ParseBoolPipe: 'boolean', ParseUUIDPipe: 'uuid', ParseArrayPipe: 'array', ParseEnumPipe: 'string', ParseObjectIdPipe: 'objectid', ParseMongoIdPipe: 'objectid', ParseDatePipe: 'datetime' };

function pipeType(args) {
  for (const a of args) {
    const n = a.type === 'NewExpression' || a.type === 'CallExpression' ? memberPath(a.callee) : memberPath(a);
    if (PIPE_TYPES[n]) return PIPE_TYPES[n];
    if (/ObjectId|MongoId/i.test(n)) return 'objectid';
  }
  return null;
}

/** Classify a method parameter by its decorator. */
function paramRole(lib, name) {
  const tables = {
    nest: { Body: 'body', Query: 'query', Param: 'param', Headers: 'header', Req: 'req', Request: 'req', UploadedFile: 'file', UploadedFiles: 'files' },
    rc: { Body: 'body', BodyParam: 'bodyField', QueryParam: 'queryField', QueryParams: 'query', Param: 'param', Params: 'params', HeaderParam: 'header', Req: 'req', UploadedFile: 'file', UploadedFiles: 'files', CurrentUser: 'user' },
    tsoa: { Body: 'body', BodyProp: 'bodyField', Query: 'queryField', Queries: 'query', Path: 'param', Header: 'header', Request: 'req', UploadedFile: 'file', UploadedFiles: 'files', FormField: 'formField' },
    inversify: { requestBody: 'body', requestParam: 'param', queryParam: 'queryField', requestHeaders: 'header', request: 'req' },
    loopback: { requestBody: 'body', 'param.path': 'param', 'param.query': 'queryField', 'param.header': 'header' },
  };
  const t = tables[lib] || {};
  if (t[name]) return t[name];
  for (const key of Object.keys(t)) if (name.startsWith(key + '.')) return t[key];
  return null;
}

const LB_TYPES = { number: 'number', integer: 'integer', string: 'string', boolean: 'boolean', date: 'date', dateTime: 'datetime', object: 'object', array: 'array' };

function controllerRoutes(interp, rec, cls, lib, cache) {
  const st = interp.state.nest || {};
  const classDecs = cls.decorators || [];
  const ctlDec = classDecs.find((d) => CLASS_DECORATORS[lib].includes(decName(d)));
  if (lib !== 'loopback' && !ctlDec) return [];
  if (classDecs.some((d) => /^(ApiExcludeController)$/.test(decName(d)))) return [];
  const ctlArg = ctlDec ? evalIn(interp, rec, decArgs(ctlDec)[0]) : U;
  let ctlPaths = pathsOf(ctlArg);
  let ctlVersion = null;
  if (ctlArg.k === 'o') {
    const v = ctlArg.props.get('version');
    if (v && v.k === 's') ctlVersion = v.v;
    if (v && v.k === 'a' && v.items[0] && v.items[0].k === 's') ctlVersion = v.items[0].v;
  }
  if (lib === 'loopback' && ctlArg.k === 'o') {
    const bp = ctlArg.props.get('basePath');
    ctlPaths = [bp && bp.k === 's' ? bp.v : ''];
  }
  const ctlName = cls.id ? cls.id.name : 'Controller';
  const tagDec = classDecs.find((d) => decName(d) === 'ApiTags' || decName(d) === 'Tags');
  const tagV = tagDec ? evalIn(interp, rec, decArgs(tagDec)[0]) : U;
  const folder = tagV.k === 's' ? tagV.v : ctlName.replace(/Controller$/, '');
  const classGuard = guardInfo(interp, rec, classDecs, lib);
  const classMws = lib === 'inversify' && ctlDec ? decArgs(ctlDec).slice(1) : [];
  const modPrefix = st.modulePrefix && st.controllerModule ? st.modulePrefix.get(st.controllerModule.get(ctlName)) || '' : '';
  const classVal = rec.scope ? interp.lookup(ctlName, rec.scope) : U;
  const out = [];
  for (const m of cls.body.body) {
    if (m.type !== 'ClassMethod' || !m.decorators || !m.decorators.length) continue;
    const decs = m.decorators;
    if (decs.some((d) => decName(d) === 'ApiExcludeEndpoint')) continue;
    const httpDec = decs.find((d) => {
      const n = decName(d);
      return METHOD_DECORATORS[lib][n] !== undefined && (lib !== 'loopback' || n !== 'operation') || (lib === 'loopback' && n === 'operation') || (lib === 'inversify' && n === 'httpMethod');
    });
    if (!httpDec) continue;
    const dn = decName(httpDec);
    let methods;
    let pathArg;
    if (dn === 'operation' || dn === 'httpMethod' || (lib === 'rc' && dn === 'Method')) {
      const mv = evalIn(interp, rec, decArgs(httpDec)[0]);
      methods = [mv.k === 's' ? mv.v.toUpperCase() : 'GET'];
      pathArg = decArgs(httpDec)[1];
    } else {
      methods = [METHOD_DECORATORS[lib][dn]];
      pathArg = decArgs(httpDec)[0];
    }
    const methodPaths = pathsOf(evalIn(interp, rec, pathArg));
    const versionDec = decs.find((d) => decName(d) === 'Version');
    const vv = versionDec ? evalIn(interp, rec, decArgs(versionDec)[0]) : U;
    const version = vv.k === 's' ? vv.v : ctlVersion || (st.versioning ? st.versioning.defaultVersion : null);
    const methodGuard = guardInfo(interp, rec, decs, lib);
    let protect = methodGuard.protect !== null ? methodGuard.protect : classGuard.protect;
    if (protect === null) protect = lib === 'nest' && st.globalGuard ? !isPublicAny(interp, rec, classDecs) : false;
    if (methodGuard.protect === false || isPublicAny(interp, rec, decs)) protect = false;
    const kind = methodGuard.kind || classGuard.kind || 'bearer';
    const login = methodGuard.login || classGuard.login;
    // parameters
    const col = new Collector('express');
    const args = [];
    const schemaBody = [];
    const schemaQuery = [];
    const params = new Map();
    const headers = [];
    let bodyRead = false;
    let mode = null;
    const ctx = { interp, rec, depth: 0, seen: new Set() };
    for (const p of m.params) {
      const target = p.type === 'TSParameterProperty' ? p.parameter : p;
      const id = target.type === 'AssignmentPattern' ? target.left : target;
      const pname = id.name || '';
      const pdecs = p.decorators || target.decorators || id.decorators || [];
      const d = pdecs.find((x) => paramRole(lib, decName(x)));
      const kindName = d ? paramRole(lib, decName(d)) : null;
      const dargs = d ? decArgs(d) : [];
      const first = d ? evalIn(interp, rec, dargs[0]) : U;
      const named = first.k === 's' ? first.v : null;
      const tf = id.typeAnnotation ? typeToField(id.typeAnnotation, named || pname, ctx) : newField(named || pname, 'any');
      const optional = !!id.optional || target.type === 'AssignmentPattern';
      switch (kindName) {
        case 'body':
          bodyRead = true;
          if (named && lib === 'nest') {
            schemaBody.push({ ...tf, name: named, required: !optional });
            args.push({ k: 'role', role: 'field', col, loc: 'body', path: [named] });
          } else {
            if (tf.type === 'object' && tf.children && tf.children.length) schemaBody.push(...tf.children);
            else if (tf.type === 'array' && tf.item && tf.item.children) col.types.push({ loc: 'body', fields: tf.item.children });
            args.push({ k: 'role', role: 'field', col, loc: 'body', path: [] });
            col.touch('body', []);
          }
          break;
        case 'bodyField': case 'formField':
          bodyRead = true;
          schemaBody.push({ ...tf, name: named || pname, required: !optional });
          if (kindName === 'formField') mode = 'form';
          args.push(U);
          break;
        case 'query':
          if (named && lib === 'nest') schemaQuery.push({ ...tf, name: named, required: !optional && !(pipeType(dargs.slice(1)) === null && false) });
          else if (tf.children) schemaQuery.push(...tf.children.map((c) => ({ ...c })));
          args.push(named ? { k: 'role', role: 'field', col, loc: 'query', path: [named] } : { k: 'role', role: 'field', col, loc: 'query', path: [] });
          break;
        case 'queryField': {
          const qn = named || (lib === 'loopback' ? (first.k === 's' ? first.v : pname) : pname);
          const t = lib === 'loopback' ? LB_TYPES[decName(d).split('.').pop()] || tf.type : tf.type;
          schemaQuery.push({ ...tf, name: qn, type: t === 'any' ? 'string' : t, required: !optional && lib !== 'inversify' && lib !== 'rc' ? !optional : false });
          args.push(U);
          break;
        }
        case 'param': {
          const nm = named || pname;
          const t = pipeType(dargs.slice(1)) || (lib === 'loopback' ? LB_TYPES[decName(d).split('.').pop()] : null) || (tf.type !== 'any' ? tf.type : 'string');
          params.set(nm, t);
          args.push({ k: 'role', role: 'param', col, name: nm, path: [nm] });
          break;
        }
        case 'params':
          args.push({ k: 'role', role: 'params', col, path: [] });
          break;
        case 'header':
          if (named) {
            if (/^(authorization)$/i.test(named)) col.hints.add('authz-header');
            else headers.push(newField(named, 'string', { required: !optional }));
          }
          args.push(U);
          break;
        case 'req':
          args.push(role('req', col));
          break;
        case 'file': case 'files':
          mode = 'form';
          if (lib !== 'nest' && named) col.file(named, kindName === 'files');
          args.push(U);
          break;
        case 'user': {
          const o = first.k === 'o' ? jsValue(first) : {};
          if (o.required) protect = true;
          args.push(U);
          break;
        }
        default:
          args.push(U);
      }
    }
    for (const f of interceptorFiles(interp, rec, decs)) col.file(f.name, f.many);
    // Swagger hints
    let summary = '';
    let description = '';
    for (const d of decs) {
      const n = decName(d);
      const a0 = evalIn(interp, rec, decArgs(d)[0]);
      if (n === 'ApiOperation' && a0.k === 'o') {
        const o = jsValue(a0);
        summary = o.summary || '';
        description = o.description || '';
      }
      if (n === 'ApiConsumes' && a0.k === 's' && /multipart/.test(a0.v)) mode = 'form';
      if (n === 'ApiQuery' && a0.k === 'o') {
        const o = jsValue(a0);
        if (o.name && !schemaQuery.some((q) => q.name === o.name)) {
          const qf = newField(o.name, { number: 'number', integer: 'integer', boolean: 'boolean' }[o.type] || (typeof o.type === 'string' ? o.type : 'string'), { required: o.required !== false });
          if (o.example !== undefined) qf.example = o.example;
          const en = a0.props.get('enum');
          if (en && en.k === 'a') qf.choices = en.items.map(jsValue);
          if (en && en.k === 'o') qf.choices = [...en.props.values()].map(jsValue).filter((x) => typeof x === 'string');
          schemaQuery.push(qf);
        }
      }
      if (n === 'ApiBody' && a0.k === 'o' && !schemaBody.length) {
        const t = a0.props.get('type');
        if (t && t.k === 'c' && t.node) {
          const f = typeToField({ type: 'TSTypeReference', typeName: { type: 'Identifier', name: t.name } }, '', ctx);
          if (f.children) schemaBody.push(...f.children);
        }
      }
      if (n === 'ApiBearerAuth') interp.state.nest.swaggerBearer = true;
    }
    // Run the method body to pick up fields read from @Req(), untyped @Body() etc.
    const classValue = classVal && classVal.k === 'c' ? classVal : null;
    const fnVal = classValue ? classValue.proto.props.get(m.key.name || m.key.value) : null;
    if (fnVal && fnVal.k === 'f') {
      const self = obj([], { proto: classValue.proto, cls: classValue });
      const prev = interp.analyzing;
      interp.analyzing = col;
      runBudget(interp, () => interp.callFunction(fnVal, args, self, null));
      interp.analyzing = prev;
    }
    if (!schemaBody.length && col.types.length) schemaBody.push(...col.types.filter((t) => t.loc === 'body').flatMap((t) => t.fields));
    const doc = parseDoc(commentText(m));
    for (const method of methods) {
      const req = buildRequest(interp, col, method === 'ALL' ? 'POST' : method, { schemaBody, schemaQuery, mode, bodyRead });
      for (const cp of ctlPaths) {
        for (const mp of methodPaths) {
          let full = joinPath(modPrefix, cp, mp);
          if (version && st.versioning && (st.versioning.type === undefined || st.versioning.type === 0 || st.versioning.type === 'URI' || String(st.versioning.type) === '0')) {
            full = joinPath(`${st.versioning.prefix === false ? '' : st.versioning.prefix}${version}`, full);
          }
          if (lib === 'nest' && st.prefix && !(st.exclude || []).some((e) => joinPath(e) === full)) full = joinPath(st.prefix, full);
          if (lib === 'rc' && st.rcPrefix) full = joinPath(st.rcPrefix, full);
          const { path: normal, params: pp } = normalizePath(full);
          const r = newRoute(normal, method === 'ALL' ? 'GET' : method, {
            name: summary || doc.summary || routeName(method, normal, humanizeMethod(m.key.name)),
            description: description || (doc.description !== doc.summary ? doc.description : ''),
            folder: [folder], query: req.query, headers: [...req.headers, ...headers], body: req.body,
            source: `${path.relative(interp.root, rec.file)}:${m.loc ? m.loc.start.line : 0}`,
          });
          r.pathParams = pp.map((x) => newField(x.name, params.get(x.name) || x.type || 'string', { required: true }));
          r._protect = protect;
          r._kind = kind;
          r._hints = new Set([...col.hints, ...(login ? ['login-strategy'] : [])]);
          out.push(r);
        }
      }
    }
  }
  return out;
}

function humanizeMethod(name) {
  if (!name) return '';
  return String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

function isPublicAny(interp, rec, decorators) {
  return (decorators || []).some((d) => isPublicDecorator(interp, rec, d));
}

/** Routes of all decorated controllers in the project. */
export function decoratedRoutes(interp, root, sources, want, cache) {
  void cache;
  const marker = /@(Controller|JsonController|Route|controller|api|get|post|put|patch|del|operation)\s*\(/;
  const files = sources.filter((f) => {
    try {
      const st = fs.statSync(f);
      if (st.size > 1024 * 1024) return false;
      const text = fs.readFileSync(f, 'utf8');
      return marker.test(text) && /from\s+['"](@nestjs\/common|routing-controllers|tsoa|@tsoa\/runtime|inversify-express-utils|@loopback\/rest|@loopback\/core|@loopback\/openapi-v3)['"]/.test(text);
    } catch {
      return false;
    }
  });
  if (!files.length) return [];
  interp.state.nest = interp.state.nest || {};
  nestPkgHooks(interp);
  // Evaluate main.ts (global prefix, versioning, global guards) and every module file.
  for (const entry of findEntries(root).slice(0, 3)) interp.loadModule(entry);
  const moduleFiles = sources.filter((f) => /\.module\.[cm]?[jt]s$/.test(f) || /app\.module/.test(f));
  const recs = [];
  for (const f of [...moduleFiles, ...files]) {
    const rec = interp.loadModule(f);
    if (rec && rec.ast) recs.push(rec);
  }
  scanModules(interp, recs);
  const out = [];
  for (const f of files) {
    const rec = interp.loadModule(f);
    if (!rec || !rec.ast) continue;
    for (const cls of rec.classes.values()) {
      const decs = cls.decorators || [];
      let lib = null;
      for (const d of decs) {
        lib = libOf(rec, decName(d));
        if (lib) break;
      }
      if (!lib) {
        // LoopBack controllers often have no class decorator: look at method decorators
        for (const m of cls.body.body) {
          for (const d of m.decorators || []) {
            const l = libOf(rec, decName(d));
            if (l === 'loopback') lib = 'loopback';
          }
        }
      }
      if (!lib) continue;
      out.push(...controllerRoutes(interp, rec, cls, lib, cache));
    }
  }
  if (interp.state.nest.swaggerBearer) interp.state.authPlugins.add('bearer');
  void want;
  void str;
  void UNDEF;
  void cloneField;
  return out;
}
