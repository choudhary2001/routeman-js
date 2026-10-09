// A small abstract interpreter for JavaScript/TypeScript modules.
//
// It evaluates the parts of a program that build routes - imports, routers, factory functions,
// plugins, loops over static arrays - without running anything outside the project's source.
// Everything it cannot know becomes an "unknown" value. Work is bounded by a step budget,
// a call-depth limit and a recursion limit, so analysis always terminates quickly.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from './parser.js';
import { readJson } from './resolve.js';
import {
  U, UNDEF, NULL, unknown, str, num, bool, obj, arr, fn, native, pkg, pkgGet, pkgCall, fromJs, truthy,
} from './values.js';

const MAX_DEPTH = 64;
const BODY_READER = /^(read|parse|get|collect|load)_?(Json|JSON|Body|RequestBody|Request|Payload|Data)(Body)?$|^(json|body)Parser$/;
/** Helpers that reject unauthenticated requests: requireAuth(event), ensureLoggedIn(req), assertAdmin(...). */
const AUTH_CALL = /^(require|ensure|assert|enforce|must|check|verify|authenticate|authorize)_?(Auth|Authenticated|Authentication|User|Session|Login|LoggedIn|Admin|Role|Roles|Token|Jwt|JWT|CurrentUser|Permission|Permissions|Signed ?In)\b/i;
const MAX_LOOP = 2000;
const MAX_RECURSION = 2;

class Scope {
  constructor(parent, kind) {
    this.parent = parent;
    this.kind = kind; // 'global' | 'module' | 'fn' | 'block' | 'class'
    this.vars = new Map();
    this.hasThis = kind === 'fn' || kind === 'module';
    this.thisVal = UNDEF;
  }

  find(name) {
    for (let s = this; s; s = s.parent) {
      const b = s.vars.get(name);
      if (b) return b;
    }
    return null;
  }

  declare(name, v) {
    const b = { v };
    this.vars.set(name, b);
    return b;
  }

  fnScope() {
    let s = this;
    while (s.parent && s.kind !== 'fn' && s.kind !== 'module') s = s.parent;
    return s;
  }

  thisValue() {
    for (let s = this; s; s = s.parent) if (s.hasThis) return s.thisVal;
    return UNDEF;
  }
}

/** Per-call bookkeeping for `return` inside abstract (both-branches) execution. */
class Frame {
  constructor() {
    this.returns = [];
    this.cond = 0;   // > 0 while inside if/switch/loop/try: returns there do not end the function
    this.done = false;
  }
}

const STRING_METHODS = new Set(['toLowerCase', 'toUpperCase', 'trim', 'trimStart', 'trimEnd', 'replace', 'replaceAll',
  'split', 'slice', 'substring', 'substr', 'startsWith', 'endsWith', 'includes', 'indexOf', 'lastIndexOf', 'concat',
  'padStart', 'padEnd', 'charAt', 'at', 'repeat', 'toString', 'valueOf', 'normalize', 'match', 'search', 'localeCompare']);

export class Interp {
  /**
   * @param {object} opts
   * @param {string} opts.root project folder
   * @param {import('./resolve.js').Resolver} opts.resolver
   * @param {Map<string,string>} opts.env values from .env files
   * @param {object} opts.hooks framework/schema/role behaviour (see frameworks/index.js)
   */
  constructor({ root, resolver, env, hooks, maxSteps = 4_000_000, log }) {
    this.root = root;
    this.resolver = resolver;
    this.env = env || new Map();
    this.hooks = hooks;
    this.maxSteps = maxSteps;
    this.steps = 0;
    this.exhausted = false;
    this.modules = new Map();
    this.stack = [];
    this.log = log || (() => {});
    this.routers = [];
    this.websockets = [];
    this.ports = [];
    this.analyzing = null; // collector while a handler is being analysed
    this.state = {};       // per-run framework state (e.g. global prefixes)
    this.parseErrors = [];
    this.globalScope = new Scope(null, 'global');
    this.modStack = [];
    this.warnings = [];
  }

  warn(msg) {
    if (!this.warnings.includes(msg)) this.warnings.push(msg);
  }

  /** "src/routes/users.js:12" for a node in the module currently being evaluated. */
  where(node) {
    const mod = this.currentMod();
    const file = mod ? path.relative(this.root, mod.file) : '';
    const line = node && node.loc ? node.loc.start.line : 0;
    return file ? `${file}${line ? ':' + line : ''}` : '';
  }

  // --- modules -------------------------------------------------------------------------------

  /** Load and evaluate a file once; returns its module record (or null). */
  loadModule(file) {
    let rec = this.modules.get(file);
    if (rec) return rec;
    rec = {
      file, ast: null, esm: false, scope: null, ns: obj([], { nsRec: null }), live: new Map(), reexports: new Map(),
      stars: [], moduleObj: null, types: new Map(), imports: new Map(), classes: new Map(), done: false, json: null,
    };
    rec.ns.nsRec = rec;
    this.modules.set(file, rec);
    if (file.endsWith('.json')) {
      rec.json = fromJs(readJson(file));
      rec.done = true;
      return rec;
    }
    let code;
    try {
      code = fs.readFileSync(file, 'utf8');
    } catch {
      rec.done = true;
      return rec;
    }
    const { ast, error } = parse(code, file);
    if (!ast) {
      this.parseErrors.push(`${path.relative(this.root, file)}: ${error}`);
      rec.done = true;
      return rec;
    }
    rec.ast = ast;
    this.modStack.push(rec);
    try {
      this.evalModule(rec);
    } finally {
      this.modStack.pop();
    }
    rec.done = true;
    return rec;
  }

  /** Parse without evaluating (used for type lookups and decorator-based frameworks). */
  parseOnly(file) {
    let rec = this.modules.get(file);
    if (rec && rec.ast) return rec;
    if (!rec) rec = this.loadModule(file);
    return rec;
  }

  evalModule(rec) {
    const scope = new Scope(this.globalScope, 'module');
    rec.scope = scope;
    const body = rec.ast.program.body;
    rec.esm = body.some((n) => /^(Import|Export)/.test(n.type));
    scope._rec = rec;
    const dir = path.dirname(rec.file);
    const moduleObj = obj([['exports', obj()]]);
    rec.moduleObj = moduleObj;
    scope.declare('module', moduleObj);
    scope.declare('exports', moduleObj.props.get('exports'));
    scope.declare('require', this.requireFor(rec));
    scope.declare('__dirname', str(dir));
    scope.declare('__filename', str(rec.file));
    scope.thisVal = rec.esm ? UNDEF : moduleObj.props.get('exports');
    // Collect declarations of types (interfaces, aliases, enums, classes) for TypeScript-aware analysis.
    for (const node of body) this.collectTypes(rec, node);
    // ESM: imports are hoisted and their modules evaluated first, in order.
    for (const node of body) {
      if (node.type === 'ImportDeclaration') this.bindImport(rec, node);
      else if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) this.bindReexport(rec, node);
    }
    this.hoist(body, scope, rec);
    const frame = new Frame();
    for (const node of body) {
      if (this.exhausted) break;
      try {
        this.execTop(node, scope, rec, frame);
      } catch (err) {
        if (err instanceof RangeError) {
          this.exhausted = true;
          break;
        }
        throw err;
      }
    }
  }

  collectTypes(rec, node) {
    let n = node;
    if ((n.type === 'ExportNamedDeclaration' || n.type === 'ExportDefaultDeclaration') && n.declaration) n = n.declaration;
    if (['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration', 'ClassDeclaration'].includes(n.type) && n.id) {
      rec.types.set(n.id.name, n);
      if (n.type === 'ClassDeclaration') rec.classes.set(n.id.name, n);
    }
    if (node.type === 'ImportDeclaration') {
      for (const s of node.specifiers) {
        const imported = s.type === 'ImportDefaultSpecifier' ? 'default' : s.type === 'ImportNamespaceSpecifier' ? '*'
          : (s.imported.name || s.imported.value);
        rec.imports.set(s.local.name, { source: node.source.value, imported });
      }
    }
    if (node.type === 'ExportNamedDeclaration' && node.source) {
      for (const s of node.specifiers || []) {
        const exported = s.exported.name || s.exported.value;
        const local = s.local ? s.local.name || s.local.value : '*';
        rec.imports.set('\0export:' + exported, { source: node.source.value, imported: local });
      }
    }
  }

  resolveSpec(spec, fromFile) {
    return this.resolver.resolve(spec, fromFile);
  }

  /** Value of `import x from spec` / `import { name } from spec` / `import * as x`. */
  importValue(target, name) {
    if (!target) return unknown(name);
    if (target.pkg !== undefined) {
      const p = this.hooks.pkgImport ? this.hooks.pkgImport(this, target.pkg, name) : undefined;
      if (p) return p;
      return name === 'default' || name === '*' ? pkg(target.pkg) : pkg(target.pkg, [{ get: name }]);
    }
    const rec = target.rec;
    if (rec.json) return name === 'default' || name === '*' ? rec.json : this.getMember(rec.json, name);
    if (name === '*') return rec.esm ? rec.ns : this.cjsExports(rec);
    if (name === 'default') return rec.esm ? this.getExport(rec, 'default') : this.cjsExports(rec);
    return rec.esm ? this.getExport(rec, name) : this.getMember(this.cjsExports(rec), name);
  }

  loadTarget(spec, fromFile) {
    const r = this.resolveSpec(spec, fromFile);
    if (!r) return null;
    if (r.pkg !== undefined) return { pkg: r.pkg };
    return { rec: this.loadModule(r.file) };
  }

  bindImport(rec, node) {
    if (node.importKind === 'type') return;
    const target = this.loadTarget(node.source.value, rec.file);
    for (const s of node.specifiers) {
      if (s.importKind === 'type') continue;
      const name = s.type === 'ImportDefaultSpecifier' ? 'default' : s.type === 'ImportNamespaceSpecifier' ? '*'
        : (s.imported.name || s.imported.value);
      rec.scope.vars.set(s.local.name, { imp: { target, name } });
    }
  }

  bindReexport(rec, node) {
    if (node.exportKind === 'type') return;
    const target = this.loadTarget(node.source.value, rec.file);
    if (node.type === 'ExportAllDeclaration') {
      if (node.exported) rec.reexports.set(node.exported.name || node.exported.value, { target, name: '*' });
      else if (target) rec.stars.push(target);
      return;
    }
    for (const s of node.specifiers || []) {
      const exported = s.exported.name || s.exported.value;
      if (s.type === 'ExportNamespaceSpecifier') rec.reexports.set(exported, { target, name: '*' });
      else if (s.type === 'ExportDefaultSpecifier') rec.reexports.set(exported, { target, name: 'default' });
      else rec.reexports.set(exported, { target, name: s.local.name || s.local.value });
    }
  }

  getExport(rec, name, seen = new Set()) {
    if (seen.has(rec)) return unknown(name);
    seen.add(rec);
    if (rec.ns.props.has(name)) return rec.ns.props.get(name);
    const live = rec.live.get(name);
    if (live) return live.v === undefined ? UNDEF : live.v;
    const re = rec.reexports.get(name);
    if (re) return this.importValue(re.target, re.name);
    if (name !== 'default') {
      for (const t of rec.stars) {
        if (t.pkg !== undefined) continue;
        const v = this.getExport(t.rec, name, seen);
        if (v.k !== 'u') return v;
      }
    }
    if (!rec.esm && rec.moduleObj) return this.getMember(this.cjsExports(rec), name);
    return unknown(name);
  }

  exportNames(rec) {
    const names = new Set([...rec.ns.props.keys(), ...rec.live.keys(), ...rec.reexports.keys()]);
    for (const t of rec.stars) if (t.rec) for (const n of this.exportNames(t.rec)) if (n !== 'default') names.add(n);
    return names;
  }

  cjsExports(rec) {
    if (rec.json) return rec.json;
    if (!rec.moduleObj) return U;
    return rec.moduleObj.props.get('exports') || U;
  }

  requireFor(rec) {
    return native('require', (args) => {
      const spec = args[0];
      if (!spec || spec.k !== 's') return unknown('require()');
      return this.requireValue(spec.v, rec.file);
    });
  }

  requireValue(spec, fromFile) {
    const target = this.loadTarget(spec, fromFile);
    if (!target) return unknown(spec);
    if (target.pkg !== undefined) return this.importValue(target, '*');
    const r = target.rec;
    if (r.json) return r.json;
    return r.esm ? r.ns : this.cjsExports(r);
  }

  // --- statements ----------------------------------------------------------------------------

  hoist(body, scope, rec) {
    for (const node of body) {
      let n = node;
      if ((n.type === 'ExportNamedDeclaration' || n.type === 'ExportDefaultDeclaration') && n.declaration) n = n.declaration;
      if (n.type === 'FunctionDeclaration' && n.id) {
        const b = scope.declare(n.id.name, fn(n, scope, rec, n.id.name));
        if (node.type === 'ExportNamedDeclaration') rec.live.set(n.id.name, b);
      } else if (n.type === 'VariableDeclaration' && n.kind === 'var') {
        for (const d of n.declarations) for (const name of patternNames(d.id)) if (!scope.vars.has(name)) scope.declare(name, UNDEF);
      }
    }
  }

  execTop(node, scope, rec, frame) {
    switch (node.type) {
      case 'ImportDeclaration':
        return;
      case 'ExportNamedDeclaration': {
        if (node.exportKind === 'type') return;
        if (node.declaration) {
          this.exec(node.declaration, scope, frame);
          const d = node.declaration;
          const names = d.type === 'VariableDeclaration' ? d.declarations.flatMap((x) => patternNames(x.id))
            : d.id ? [d.id.name] : [];
          for (const name of names) {
            const b = scope.vars.get(name);
            if (b) rec.live.set(name, b);
          }
        } else if (!node.source) {
          for (const s of node.specifiers) {
            const local = s.local.name;
            const exported = s.exported.name || s.exported.value;
            const b = scope.find(local);
            if (b && b.imp) rec.reexports.set(exported, b.imp);
            else if (b) rec.live.set(exported, b);
            else rec.ns.props.set(exported, unknown(local));
          }
        }
        return;
      }
      case 'ExportDefaultDeclaration': {
        const d = node.declaration;
        let v;
        if (d.type === 'FunctionDeclaration') {
          v = d.id ? scope.find(d.id.name).v : fn(d, scope, rec, 'default');
        } else if (d.type === 'ClassDeclaration') {
          v = this.makeClass(d, scope, rec);
          if (d.id) scope.declare(d.id.name, v);
        } else if (d.type === 'TSInterfaceDeclaration') {
          return;
        } else {
          v = this.eval(d, scope);
          if (v && v.k === 'f' && !v.name) v.name = path.basename(rec.file).replace(/\.[^.]+$/, '');
        }
        rec.ns.props.set('default', v);
        return;
      }
      case 'ExportAllDeclaration':
        return;
      case 'TSExportAssignment':
        rec.esm = false;
        rec.moduleObj.props.set('exports', this.eval(node.expression, scope));
        return;
      default:
        this.exec(node, scope, frame);
    }
  }

  execBlock(body, scope, frame) {
    this.hoistBlock(body, scope);
    for (const node of body) {
      if (frame.done || this.exhausted) return;
      this.exec(node, scope, frame);
    }
  }

  hoistBlock(body, scope) {
    for (const n of body) {
      if (n.type === 'FunctionDeclaration' && n.id) scope.declare(n.id.name, fn(n, scope, scope.mod || this.currentMod(), n.id.name));
    }
  }

  currentMod() {
    const top = this.stack[this.stack.length - 1];
    if (top && top.mod) return top.mod;
    return this.modStack[this.modStack.length - 1] || null;
  }

  exec(node, scope, frame) {
    if (this.exhausted || frame.done) return;
    switch (node.type) {
      case 'ExpressionStatement':
        this.eval(node.expression, scope);
        return;
      case 'VariableDeclaration':
        for (const d of node.declarations) {
          let v = d.init ? this.eval(d.init, scope) : UNDEF;
          if (v.k === 'f' && !v.name && d.id.type === 'Identifier') v.name = d.id.name;
          if (v.k === 'c' && !v.name && d.id.type === 'Identifier') v.name = d.id.name;
          if (this.analyzing && d.id.typeAnnotation && this.hooks.onTyped) v = this.hooks.onTyped(this, v, d.id.typeAnnotation, scope) || v;
          this.bind(d.id, v, scope, 'declare');
        }
        return;
      case 'FunctionDeclaration':
        if (node.id && !scope.vars.has(node.id.name)) scope.declare(node.id.name, fn(node, scope, this.currentMod(), node.id.name));
        return;
      case 'ClassDeclaration':
        if (node.id) scope.declare(node.id.name, this.makeClass(node, scope, this.currentMod()));
        return;
      case 'ReturnStatement': {
        const v = node.argument ? this.eval(node.argument, scope) : UNDEF;
        frame.returns.push(v);
        if (frame.cond === 0) frame.done = true;
        return;
      }
      case 'ThrowStatement':
        if (node.argument) this.eval(node.argument, scope);
        if (frame.cond === 0) frame.done = true;
        return;
      case 'IfStatement': {
        const start = this.analyzing ? this.analyzing.negLog.length : 0;
        const test = this.eval(node.test, scope);
        const literal = node.test.type === 'BooleanLiteral' ? node.test.value : undefined;
        frame.cond++;
        const hook = this.analyzing && this.hooks.onIf ? this.hooks.onIf(this, test, node, start) : null;
        if (literal !== false) {
          if (hook) hook.enter('then');
          this.exec(node.consequent, new Scope(scope, 'block'), frame);
          if (hook) hook.leave('then');
        }
        if (node.alternate && literal !== true) {
          if (hook) hook.enter('else');
          this.exec(node.alternate, new Scope(scope, 'block'), frame);
          if (hook) hook.leave('else');
        }
        frame.cond--;
        return;
      }
      case 'BlockStatement':
      case 'StaticBlock':
        this.execBlock(node.body, new Scope(scope, 'block'), frame);
        return;
      case 'TryStatement':
        this.exec(node.block, scope, frame);
        if (node.handler) {
          frame.cond++;
          const s = new Scope(scope, 'block');
          if (node.handler.param) this.bind(node.handler.param, U, s, 'declare');
          this.exec(node.handler.body, s, frame);
          frame.cond--;
        }
        if (node.finalizer) this.exec(node.finalizer, scope, frame);
        return;
      case 'SwitchStatement': {
        const disc = this.eval(node.discriminant, scope);
        const s = new Scope(scope, 'block');
        frame.cond++;
        let pending = [];
        for (const c of node.cases) {
          const test = c.test ? this.eval(c.test, s) : null;
          // case 'PUT': case 'PATCH': ... -> the body runs for every label that falls through to it
          if (!c.consequent.length) { pending.push(test); continue; }
          const tests = [...pending, test];
          pending = [];
          const hooks = this.analyzing && this.hooks.onCase ? tests.map((t) => this.hooks.onCase(this, disc, t, c)).filter(Boolean) : [];
          if (hooks.length > 1) {
            for (const hook of hooks) {
              hook.enter();
              this.execBlock(c.consequent, s, frame);
              hook.leave();
            }
          } else {
            if (hooks[0]) hooks[0].enter();
            this.execBlock(c.consequent, s, frame);
            if (hooks[0]) hooks[0].leave();
          }
          if (frame.done) break;
        }
        frame.cond--;
        return;
      }
      case 'ForStatement': {
        const s = new Scope(scope, 'block');
        if (node.init) {
          if (node.init.type === 'VariableDeclaration') this.exec(node.init, s, frame);
          else this.eval(node.init, s);
        }
        if (node.test) this.eval(node.test, s);
        frame.cond++;
        this.exec(node.body, new Scope(s, 'block'), frame);
        frame.cond--;
        return;
      }
      case 'ForOfStatement':
      case 'ForInStatement': {
        const right = this.eval(node.right, scope);
        let items = null;
        if (node.type === 'ForOfStatement') {
          if (right.k === 'a') items = right.items;
          else if (right.k === 's') items = [...right.v].map((c) => str(c));
          else if (right.k === 'o' && right.mapEntries) items = right.mapEntries;
        } else if (right.k === 'o') items = [...right.props.keys()].map((k) => str(k));
        else if (right.k === 'a') items = right.items.map((_, i) => str(String(i)));
        frame.cond++;
        const list = items ? items.slice(0, MAX_LOOP) : [this.iterItem(right)];
        for (const item of list) {
          if (this.exhausted || frame.done) break;
          const s = new Scope(scope, 'block');
          const left = node.left.type === 'VariableDeclaration' ? node.left.declarations[0].id : node.left;
          this.bind(left, item, s, node.left.type === 'VariableDeclaration' ? 'declare' : 'assign');
          this.exec(node.body, s, frame);
        }
        frame.cond--;
        return;
      }
      case 'WhileStatement':
      case 'DoWhileStatement':
        this.eval(node.test, scope);
        frame.cond++;
        this.exec(node.body, new Scope(scope, 'block'), frame);
        frame.cond--;
        return;
      case 'LabeledStatement':
        this.exec(node.body, scope, frame);
        return;
      case 'TSEnumDeclaration': {
        const o = obj();
        let next = 0;
        for (const m of node.members || (node.body && node.body.members) || []) {
          const key = m.id.name || m.id.value;
          let v;
          if (m.initializer) {
            v = this.eval(m.initializer, scope);
            if (v.k === 'n') next = v.v + 1;
          } else {
            v = num(next++);
          }
          o.props.set(key, v);
        }
        o.isEnum = true;
        scope.declare(node.id.name, o);
        return;
      }
      case 'TSModuleDeclaration': {
        if (node.body && node.body.type === 'TSModuleBlock' && node.id.type === 'Identifier') {
          const s = new Scope(scope, 'block');
          const o = obj();
          for (const st of node.body.body) {
            const inner = st.type === 'ExportNamedDeclaration' && st.declaration ? st.declaration : st;
            this.exec(inner, s, frame);
          }
          for (const [k, b] of s.vars) o.props.set(k, b.v);
          scope.declare(node.id.name, o);
        }
        return;
      }
      case 'TSImportEqualsDeclaration': {
        const ref = node.moduleReference;
        if (ref.type === 'TSExternalModuleReference') {
          const rec = this.currentModRec(scope);
          scope.declare(node.id.name, this.requireValue(ref.expression.value, rec ? rec.file : path.join(this.root, 'x.ts')));
        }
        return;
      }
      case 'ExportNamedDeclaration':
      case 'ExportDefaultDeclaration': {
        // nested inside a namespace or evaluated out of order
        if (node.declaration) this.exec(node.declaration, scope, frame);
        return;
      }
      default:
        return; // EmptyStatement, DebuggerStatement, TS declarations, ...
    }
  }

  currentModRec(scope) {
    return this.modOf(scope);
  }

  iterItem(v) {
    if (v && v.k === 'role' && this.hooks.roleGet) return this.hooks.roleGet(this, v, '[]') || U;
    return U;
  }

  // --- patterns ------------------------------------------------------------------------------

  /** Bind a declaration/parameter/assignment pattern to a value. mode: 'declare' | 'assign'. */
  bind(pattern, value, scope, mode) {
    if (!pattern) return;
    switch (pattern.type) {
      case 'Identifier':
        if (mode === 'declare') scope.declare(pattern.name, value);
        else this.assign(pattern.name, value, scope);
        return;
      case 'AssignmentPattern': {
        let v = value;
        if (v && v.k === 'role' && this.hooks.roleDefault) {
          this.hooks.roleDefault(this, v, this.eval(pattern.right, scope), pattern.right);
        } else if (!v || v.k === 'undef' || v.k === 'u') {
          const d = this.eval(pattern.right, scope);
          if (!v || v.k === 'undef' || d.k !== 'u') v = d;
        }
        this.bind(pattern.left, v, scope, mode);
        return;
      }
      case 'ObjectPattern': {
        const used = [];
        for (const p of pattern.properties) {
          if (p.type === 'RestElement') {
            this.bind(p.argument, this.restOf(value, used), scope, mode);
            continue;
          }
          let key;
          if (p.computed) {
            const k = this.eval(p.key, scope);
            key = k.k === 's' || k.k === 'n' ? String(k.v) : null;
          } else key = p.key.name !== undefined ? p.key.name : String(p.key.value);
          used.push(key);
          const v = key == null ? U : this.getMember(value, key);
          this.bind(p.value, v, scope, mode);
        }
        return;
      }
      case 'ArrayPattern':
        pattern.elements.forEach((el, i) => {
          if (!el) return;
          if (el.type === 'RestElement') {
            this.bind(el.argument, value && value.k === 'a' ? arr(value.items.slice(i)) : U, scope, mode);
          } else this.bind(el, this.getMember(value, String(i)), scope, mode);
        });
        return;
      case 'RestElement':
        this.bind(pattern.argument, value, scope, mode);
        return;
      case 'TSParameterProperty':
        this.bind(pattern.parameter, value, scope, mode);
        return;
      case 'MemberExpression': {
        const o = this.eval(pattern.object, scope);
        const key = this.memberKey(pattern, scope);
        if (key != null) this.setMember(o, key, value);
        return;
      }
      default:
        if (pattern.type.startsWith('TS') && pattern.expression) this.bind(pattern.expression, value, scope, mode);
    }
  }

  restOf(value, used) {
    if (!value) return U;
    if (value.k === 'role') return value; // ...rest of req.body is still the body
    if (value.k === 'o') return obj([...value.props].filter(([k]) => !used.includes(k)));
    return U;
  }

  assign(name, value, scope) {
    const b = scope.find(name);
    if (b) {
      if (b.imp) return;
      b.v = value;
    } else {
      let s = scope;
      while (s.parent && s.kind !== 'module') s = s.parent;
      s.declare(name, value);
    }
  }

  // --- expressions ---------------------------------------------------------------------------

  eval(node, scope) {
    if (++this.steps > this.maxSteps) {
      if (!this.exhausted) this.log('analysis budget exhausted; results may be incomplete');
      this.exhausted = true;
    }
    if (this.exhausted || !node) return U;
    switch (node.type) {
      case 'StringLiteral': return str(node.value);
      case 'NumericLiteral': return num(node.value);
      case 'BooleanLiteral': return bool(node.value);
      case 'NullLiteral': return NULL;
      case 'BigIntLiteral': return num(Number(node.value));
      case 'DecimalLiteral': return num(Number(node.value));
      case 'RegExpLiteral': return { k: 're', source: node.pattern, flags: node.flags };
      case 'TemplateLiteral': return this.template(node, scope);
      case 'Identifier': return this.lookup(node.name, scope);
      case 'ThisExpression': return scope.thisValue();
      case 'MemberExpression':
      case 'OptionalMemberExpression': {
        if (node.object.type === 'Super') {
          const home = this.homeClass(scope);
          const sup = home && home.superVal;
          const key = this.memberKey(node, scope);
          if (sup && sup.k === 'c' && key != null) return this.withThis(this.protoLookup(sup.proto, key), scope.thisValue());
          return U;
        }
        const o = this.eval(node.object, scope);
        const key = this.memberKey(node, scope);
        if (key == null) return o.k === 'role' && this.hooks.roleGet ? (this.hooks.roleGet(this, o, '[]') || U) : U;
        return this.getMember(o, key, node);
      }
      case 'CallExpression':
      case 'OptionalCallExpression':
        return this.evalCall(node, scope, false);
      case 'NewExpression':
        return this.evalCall(node, scope, true);
      case 'ImportExpression': {
        const spec = this.eval(node.source, scope);
        const rec = this.currentModRec(scope);
        if (spec.k === 's' && rec) return this.dynamicImport(spec.v, rec.file);
        return U;
      }
      case 'AwaitExpression':
        return this.eval(node.argument, scope);
      case 'ParenthesizedExpression':
      case 'TSNonNullExpression':
      case 'TSInstantiationExpression':
        return this.eval(node.expression, scope);
      case 'TSAsExpression':
      case 'TSSatisfiesExpression':
      case 'TSTypeAssertion':
      case 'TypeCastExpression': {
        const v = this.eval(node.expression, scope);
        if (this.analyzing && this.hooks.onTyped && v.k === 'role') {
          const t = node.typeAnnotation;
          return this.hooks.onTyped(this, v, t && t.type === 'TypeAnnotation' ? t : { typeAnnotation: t }, scope) || v;
        }
        return v;
      }
      case 'ArrowFunctionExpression':
      case 'FunctionExpression':
        return fn(node, scope, this.modOf(scope), node.id ? node.id.name : '');
      case 'ClassExpression':
        return this.makeClass(node, scope, this.modOf(scope));
      case 'ObjectExpression':
        return this.objectLiteral(node, scope);
      case 'ArrayExpression': {
        const items = [];
        for (const el of node.elements) {
          if (!el) items.push(UNDEF);
          else if (el.type === 'SpreadElement') {
            const v = this.eval(el.argument, scope);
            if (v.k === 'a') items.push(...v.items);
            else if (v.k === 'o' && v.mapEntries) items.push(...v.mapEntries);
            else if (v.k !== 'undef' && v.k !== 'null') items.push(v);
          } else items.push(this.eval(el, scope));
        }
        return arr(items);
      }
      case 'AssignmentExpression':
        return this.assignment(node, scope);
      case 'LogicalExpression':
        return this.logical(node, scope);
      case 'ConditionalExpression': {
        const t = truthy(this.eval(node.test, scope));
        if (t === true) return this.eval(node.consequent, scope);
        if (t === false) return this.eval(node.alternate, scope);
        const a = this.eval(node.consequent, scope);
        const b = this.eval(node.alternate, scope);
        return a.k === 'u' || a.k === 'undef' || a.k === 'null' ? b : a;
      }
      case 'BinaryExpression':
        return this.binary(node, scope);
      case 'UnaryExpression': {
        const v = this.eval(node.argument, scope);
        if (this.analyzing && this.hooks.onUnary) {
          const h = this.hooks.onUnary(this, node.operator, v);
          if (h) return h;
        }
        switch (node.operator) {
          case '!': { const t = truthy(v); return t === undefined ? U : bool(!t); }
          case '-': return v.k === 'n' ? num(-v.v) : U;
          case '+': return v.k === 'n' ? v : v.k === 's' && v.v.trim() && !Number.isNaN(Number(v.v)) ? num(Number(v.v)) : U;
          case 'void': return UNDEF;
          case 'typeof': return typeOf(v);
          default: return U;
        }
      }
      case 'UpdateExpression':
        this.eval(node.argument, scope);
        return U;
      case 'SequenceExpression': {
        let v = U;
        for (const e of node.expressions) v = this.eval(e, scope);
        return v;
      }
      case 'MetaProperty': {
        if (node.meta.name === 'import') {
          const rec = this.currentModRec(scope);
          const file = rec ? rec.file : this.root;
          return obj([['url', str('file://' + file)], ['dirname', str(path.dirname(file))], ['filename', str(file)],
            ['dir', str(path.dirname(file))], ['path', str(file)], ['env', this.envObject()], ['main', bool(false)]]);
        }
        return U;
      }
      case 'TaggedTemplateExpression':
        this.eval(node.tag, scope);
        return U;
      case 'YieldExpression':
        if (node.argument) this.eval(node.argument, scope);
        return U;
      case 'SpreadElement':
        return this.eval(node.argument, scope);
      case 'DoExpression':
        return U;
      default:
        return U; // JSX, Import, Super, private names...
    }
  }

  modOf(scope) {
    let s = scope;
    while (s && s.kind !== 'module') s = s.parent;
    if (!s) return null;
    if (s._rec === undefined) {
      s._rec = null;
      for (const rec of this.modules.values()) if (rec.scope === s) { s._rec = rec; break; }
    }
    return s._rec;
  }

  homeClass(scope) {
    for (let s = scope; s; s = s.parent) if (s.homeClass) return s.homeClass;
    return null;
  }

  memberKey(node, scope) {
    if (!node.computed) {
      const p = node.property;
      if (p.type === 'Identifier') return p.name;
      if (p.type === 'PrivateName') return '#' + p.id.name;
      return null;
    }
    const k = this.eval(node.property, scope);
    if (k.k === 's') return k.v;
    if (k.k === 'n') return String(k.v);
    return null;
  }

  template(node, scope) {
    let out = '';
    let partial = false;
    node.quasis.forEach((q, i) => {
      out += q.value.cooked != null ? q.value.cooked : q.value.raw;
      if (i < node.expressions.length) {
        const v = this.eval(node.expressions[i], scope);
        if (v.k === 's') { out += v.v; if (v.partial) partial = true; } else if (v.k === 'n' || v.k === 'b') out += String(v.v);
        else partial = true;
      }
    });
    const s = str(out);
    if (partial) s.partial = true;
    return s;
  }

  envObject() {
    if (!this._env) {
      const o = obj([...this.env].map(([k, v]) => [k, str(v)]));
      o.isEnv = true;
      this._env = o;
    }
    return this._env;
  }

  lookup(name, scope) {
    const b = scope.find(name);
    if (b) {
      if (b.imp) return this.importValue(b.imp.target, b.imp.name);
      return b.v === undefined ? UNDEF : b.v;
    }
    return this.global(name, scope);
  }

  global(name, scope) {
    if (this.hooks.global) {
      const v = this.hooks.global(this, name, scope);
      if (v) return v;
    }
    switch (name) {
      case 'undefined': return UNDEF;
      case 'NaN': return num(NaN);
      case 'Infinity': return num(Infinity);
      case 'process': return this.processValue();
      case 'Object': case 'Array': case 'JSON': case 'Promise': case 'String': case 'Number': case 'Boolean': case 'URL': case 'Map':
      case 'parseInt': case 'parseFloat': case 'Bun': case 'Deno': case 'Reflect': case 'Symbol': case 'Date':
        return pkg('#global', [{ get: name }]);
      case 'globalThis': case 'global': case 'window':
        return pkg('#global');
      default:
        return unknown(name);
    }
  }

  processValue() {
    if (!this._process) {
      this._process = obj([['env', this.envObject()], ['cwd', native('cwd', () => str(this.root))],
        ['argv', arr([])], ['platform', str('linux')]]);
    }
    return this._process;
  }

  dynamicImport(spec, fromFile) {
    const target = this.loadTarget(spec, fromFile);
    if (!target) return U;
    if (target.pkg !== undefined) return this.importValue(target, '*');
    const r = target.rec;
    if (r.esm) return r.ns;
    const exp = this.cjsExports(r);
    return obj([['default', exp]], { proxyOf: exp });
  }

  objectLiteral(node, scope) {
    const o = obj();
    for (const p of node.properties) {
      if (p.type === 'SpreadElement') {
        const v = this.eval(p.argument, scope);
        if (v.k === 'o') {
          if (v.nsRec) for (const n of this.exportNames(v.nsRec)) o.props.set(n, this.getExport(v.nsRec, n));
          for (const [k, val] of v.props) o.props.set(k, val);
        } else if (v.k === 'role') o.spreadRole = v;
        continue;
      }
      let key;
      if (p.computed) {
        const k = this.eval(p.key, scope);
        key = k.k === 's' || k.k === 'n' ? String(k.v) : null;
        if (key == null) continue;
      } else key = p.key.type === 'Identifier' ? p.key.name : String(p.key.value);
      if (p.type === 'ObjectMethod') {
        const f = fn(p, scope, this.modOf(scope), key);
        if (p.kind === 'get') { o.getters = o.getters || new Map(); o.getters.set(key, f); } else o.props.set(key, f);
        continue;
      }
      const v = this.eval(p.value, scope);
      if ((v.k === 'f' || v.k === 'c') && !v.name) v.name = key;
      o.props.set(key, v);
    }
    o.node = node;
    return o;
  }

  assignment(node, scope) {
    let v = this.eval(node.right, scope);
    if (node.operator !== '=') {
      const cur = this.eval(node.left, scope);
      if (node.operator === '+=' && (cur.k === 's' || cur.k === 'n') && (v.k === 's' || v.k === 'n')) {
        v = cur.k === 'n' && v.k === 'n' ? num(cur.v + v.v) : str(String(cur.v) + String(v.v));
      } else if (node.operator === '||=' || node.operator === '??=') {
        if (truthy(cur) === true || (node.operator === '??=' && cur.k !== 'u' && cur.k !== 'undef' && cur.k !== 'null')) return cur;
      } else {
        v = U;
      }
    }
    const left = node.left;
    if (left.type === 'Identifier') {
      if ((v.k === 'f' || v.k === 'c') && !v.name) v.name = left.name;
      this.assign(left.name, v, scope);
    } else if (left.type === 'MemberExpression' || left.type === 'OptionalMemberExpression') {
      const o = this.eval(left.object, scope);
      const key = this.memberKey(left, scope);
      if (key != null) {
        if ((v.k === 'f' || v.k === 'c') && !v.name) v.name = key;
        this.setMember(o, key, v);
      }
    } else {
      this.bind(left, v, scope, 'assign');
    }
    return v;
  }

  setMember(o, key, v) {
    if (!o) return;
    if (o.k === 'o') {
      if (o.nsRec) return;
      o.props.set(key, v);
    } else if (o.k === 'f' || o.k === 'c' || o.k === 'r') {
      if (o.k === 'r' && this.hooks.routerSet && this.hooks.routerSet(this, o, key, v)) return;
      if (!o.props) o.props = new Map();
      o.props.set(key, v);
    } else if (o.k === 'a' && /^\d+$/.test(key)) {
      o.items[Number(key)] = v;
    } else if (o.k === 'role' && this.hooks.roleSet) {
      this.hooks.roleSet(this, o, key, v);
    }
  }

  logical(node, scope) {
    const l = this.eval(node.left, scope);
    const t = truthy(l);
    if (node.operator === '&&') {
      if (t === false) return l;
      const r = this.eval(node.right, scope);
      if (l.k === 'cond' && r.k === 'cond') return { k: 'cond', and: [l, r] };
      if (l.k === 'cond') return l;
      return r;
    }
    if (l.k === 'cond') {
      this.eval(node.right, scope);
      return l;
    }
    const nullish = l.k === 'null' || l.k === 'undef';
    if (node.operator === '??') {
      if (!nullish && l.k !== 'u' && l.k !== 'role') return l;
    } else if (t === true) return l;
    const r = this.eval(node.right, scope);
    if (l.k === 'role' && this.hooks.roleDefault) {
      this.hooks.roleDefault(this, l, r, node.right);
      return l;
    }
    if (l.k === 'u' || nullish || t === false) return r.k === 'u' && l.k === 'u' ? l : r;
    return l;
  }

  binary(node, scope) {
    const l = node.left.type === 'PrivateName' ? U : this.eval(node.left, scope);
    const r = this.eval(node.right, scope);
    if (this.analyzing && this.hooks.onBinary && (l.k === 'role' || r.k === 'role' || l.k === 'cond' || r.k === 'cond' || l.k === 'typeof')) {
      const h = this.hooks.onBinary(this, node.operator, l, r, node);
      if (h) return h;
    }
    const op = node.operator;
    const prim = (v) => v.k === 's' || v.k === 'n' || v.k === 'b' || v.k === 'null' || v.k === 'undef';
    if (op === '+') {
      if ((l.k === 's' || l.k === 'n') && (r.k === 's' || r.k === 'n')) {
        if (l.k === 'n' && r.k === 'n') return num(l.v + r.v);
        const s = str(String(l.v) + String(r.v));
        if (l.partial || r.partial) s.partial = true;
        return s;
      }
      if (l.k === 's' && r.k !== 's') { const s = str(l.v); s.partial = true; return s; }
      if (r.k === 's' && l.k !== 's') { const s = str(r.v); s.partial = true; return s; }
      return U;
    }
    if (prim(l) && prim(r)) {
      const a = l.v === undefined ? (l.k === 'null' ? null : undefined) : l.v;
      const b = r.v === undefined ? (r.k === 'null' ? null : undefined) : r.v;
      switch (op) {
        case '===': return bool(a === b);
        case '!==': return bool(a !== b);
        // eslint-disable-next-line eqeqeq
        case '==': return bool(a == b);
        // eslint-disable-next-line eqeqeq
        case '!=': return bool(a != b);
        case '-': return l.k === 'n' && r.k === 'n' ? num(a - b) : U;
        case '*': return l.k === 'n' && r.k === 'n' ? num(a * b) : U;
        case '/': return l.k === 'n' && r.k === 'n' ? num(a / b) : U;
        case '<': return bool(a < b);
        case '>': return bool(a > b);
        case '<=': return bool(a <= b);
        case '>=': return bool(a >= b);
        default: return U;
      }
    }
    return U;
  }

  // --- calls ---------------------------------------------------------------------------------

  evalArgs(args, scope) {
    const out = [];
    for (const a of args) {
      if (a.type === 'SpreadElement') {
        const v = this.eval(a.argument, scope);
        if (v.k === 'a') out.push(...v.items);
        else out.push(v);
      } else if (a.type === 'ArgumentPlaceholder') out.push(U);
      else out.push(this.eval(a, scope));
    }
    return out;
  }

  evalCall(node, scope, isNew) {
    const callee = node.callee;
    if (callee.type === 'Import') {
      const spec = node.arguments[0] ? this.eval(node.arguments[0], scope) : U;
      const rec = this.modOf(scope);
      return spec.k === 's' && rec ? this.dynamicImport(spec.v, rec.file) : U;
    }
    if (callee.type === 'Super') {
      const home = this.homeClass(scope);
      const args = this.evalArgs(node.arguments, scope);
      if (home && home.superVal) {
        const sup = home.superVal;
        const self = scope.thisValue();
        if (sup.k === 'c' && self.k === 'o') this.initInstance(sup, self, args);
        else if (sup.k === 'p' && self.k === 'o') {
          const made = this.callValue(sup, args, UNDEF, node, true);
          if (made.k === 'r') self.routerBase = made;
        }
      }
      return UNDEF;
    }
    if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
      if (callee.object.type === 'Super') {
        const m = this.eval(callee, scope);
        return this.callValue(m, this.evalArgs(node.arguments, scope), scope.thisValue(), node, isNew);
      }
      const o = this.eval(callee.object, scope);
      const key = this.memberKey(callee, scope);
      const args = this.evalArgs(node.arguments, scope);
      if (key == null) return U;
      return this.callMethod(o, key, args, node, isNew);
    }
    const f = this.eval(callee, scope);
    const args = this.evalArgs(node.arguments, scope);
    return this.callValue(f, args, UNDEF, node, isNew);
  }

  callMethod(o, key, args, node, isNew = false) {
    const h = this.hooks;
    if (this.analyzing && AUTH_CALL.test(key) && !fromRequestData(args)) this.analyzing.hints.add('protect');
    switch (o.k) {
      case 'r': {
        const v = h.routerMethod ? h.routerMethod(this, o, key, args, node) : undefined;
        if (v) return v;
        break;
      }
      case 'z': {
        const v = h.schemaMethod ? h.schemaMethod(this, o, key, args, node) : undefined;
        if (v) return v;
        return o;
      }
      case 'ev': {
        const v = h.evMethod ? h.evMethod(this, o, key, args, node) : undefined;
        return v || o;
      }
      case 'role': {
        const v = h.roleMethod ? h.roleMethod(this, o, key, args, node) : undefined;
        if (v) return v;
        break;
      }
      case 's': return this.stringMethod(o, key, args);
      case 're':
        // /^\d{10}$/.test(req.body.isbn): the field's pattern
        if (this.analyzing && (key === 'test' || key === 'exec') && args[0] && args[0].k === 'role' && args[0].role === 'field' && args[0].path.length) {
          const node = this.analyzing.touch(args[0].loc, args[0].path);
          if (node) { node.pattern = o.source; if (!node.type || node.type === 'any') node.type = 'string'; }
        }
        return U;
      case 'a': {
        const v = this.arrayMethod(o, key, args, node);
        if (v) return v;
        break;
      }
      case 'p': {
        const p = this.getMember(o, key, node);
        if (p.k === 'p') {
          const called = pkgCall(p, args, isNew, node);
          const v = h.pkgCall ? h.pkgCall(this, called, args, isNew, node) : undefined;
          this.callbacks(args, node);
          return v || called;
        }
        return this.callValue(p, args, o, node, isNew);
      }
      case 'f': case 'nf':
        if (key === 'call') return this.callValue(o, args.slice(1), args[0] || UNDEF, node);
        if (key === 'apply') return this.callValue(o, args[1] && args[1].k === 'a' ? args[1].items : [], args[0] || UNDEF, node);
        if (key === 'bind') {
          if (o.k === 'nf') return o;
          return { ...o, boundThis: args[0] || UNDEF, boundArgs: args.slice(1) };
        }
        break;
      case 'u':
      case 'undef':
      case 'null': {
        if (key === 'then' || key === 'catch' || key === 'finally') {
          if (key === 'then' && args[0]) this.callValue(args[0], [U], UNDEF, node);
          return o;
        }
        const v = h.unknownCall ? h.unknownCall(this, o, key, args, node) : undefined;
        if (v) return v;
        if (this.analyzing) this.callbacks(args, node);
        return unknown(o.name ? `${o.name}.${key}()` : `${key}()`);
      }
      default:
        break;
    }
    if (key === 'then' && args[0] && o.k !== 'o') return this.callValue(args[0], [o], UNDEF, node);
    const m = this.getMember(o, key, node);
    if (m.k === 'u') {
      if (key === 'then' && args[0]) return this.callValue(args[0], [o], UNDEF, node);
      if (key === 'catch' || key === 'finally') return o;
      if (o.k === 'o' && o.isEnv) return U;
      const v = h.unknownCall ? h.unknownCall(this, m, '', args, node, o, key) : undefined;
      if (v) return v;
      if (this.analyzing) this.callbacks(args, node);
      return unknown(m.name || key + '()');
    }
    return this.callValue(m, args, o, node, isNew);
  }

  /** Call function arguments of an unknown callee once, so callbacks still get analysed. */
  callbacks(args, node) {
    const inner = [];
    for (const a of args) {
      if (a && a.k === 'a') inner.push(...a.items.filter((x) => x && x.k === 'f').slice(0, 50));
      else if (a && a.k === 'o' && !a.nsRec) for (const v of a.props.values()) if (v && v.k === 'a') inner.push(...v.items.filter((x) => x && x.k === 'f').slice(0, 50));
    }
    if (!this.analyzing) for (const f of inner) this.callFunction(f, f.node.params.map(() => U), UNDEF, node);
    for (const a of args) {
      if (a && a.k === 'f' && !a.node.async && this.analyzing && this.analyzing.followCallbacks === false) continue;
      if (a && a.k === 'f') this.callFunction(a, a.node.params.map(() => U), UNDEF, node);
    }
  }

  callValue(f, args, thisVal, node, isNew = false) {
    if (!f) return U;
    if (this.analyzing) {
      const name = f.k === 'f' || f.k === 'nf' ? f.name : f.k === 'u' ? f.name : '';
      const short = name ? String(name).split('.').pop() : '';
      if (short && AUTH_CALL.test(short) && !fromRequestData(args)) this.analyzing.hints.add('protect');
      // readJson(req) / parseBody(req) / getRequestBody(req): stream readers of raw node:http servers
      if (short && BODY_READER.test(short) && args.some((a) => a && a.k === 'role' && (a.role === 'nodeReq' || a.role === 'req'))) {
        const col = this.analyzing;
        col.touch('body', []);
        return { k: 'role', role: 'field', col, loc: 'body', path: [] };
      }
    }
    switch (f.k) {
      case 'f':
        if (isNew) {
          const inst = obj([], { cls: f });
          const r = this.callFunction(f, args, inst, node);
          return r.k === 'o' || r.k === 'r' ? r : inst;
        }
        return this.callFunction(f, args, thisVal, node);
      case 'nf':
        return f.impl(args, thisVal, node, isNew) || U;
      case 'c':
        return this.construct(f, args, node);
      case 'p': {
        const called = pkgCall(f, args, isNew, node);
        const v = this.hooks.pkgCall ? this.hooks.pkgCall(this, called, args, isNew, node) : undefined;
        if (!v) this.callbacks(args, node);
        return v || called;
      }
      case 'role': {
        const v = this.hooks.roleCall ? this.hooks.roleCall(this, f, args, node) : undefined;
        return v || U;
      }
      case 'r': {
        const v = this.hooks.routerCall ? this.hooks.routerCall(this, f, args, node) : undefined;
        return v || U;
      }
      case 'z':
        return f;
      case 'o':
        if (f.proxyOf) return this.callValue(f.proxyOf, args, thisVal, node, isNew);
        if (this.hooks.objectCall) {
          const v = this.hooks.objectCall(this, f, args, isNew);
          if (v) return v;
        }
        return isNew && f.ormModel ? obj([], { ormInstance: f.ormModel }) : U;
      default: {
        const v = this.hooks.unknownCall ? this.hooks.unknownCall(this, f, null, args, node) : undefined;
        if (v) return v;
        if (this.analyzing) this.callbacks(args, node);
        return unknown(f.name ? f.name + '()' : '');
      }
    }
  }

  callFunction(f, args, thisVal, node) {
    if (this.exhausted || !f.node) return U;
    if (this.stack.length > MAX_DEPTH) return U;
    let seen = 0;
    for (const fr of this.stack) if (fr.node === f.node) seen++;
    if (seen >= MAX_RECURSION) return U;
    const fnNode = f.node;
    if (fnNode.generator) return U;
    const scope = new Scope(f.scope, 'fn');
    const isArrow = fnNode.type === 'ArrowFunctionExpression';
    if (isArrow) scope.hasThis = false;
    else scope.thisVal = f.boundThis || thisVal || UNDEF;
    if (f.homeClass) scope.homeClass = f.homeClass;
    if (f.boundArgs) args = [...f.boundArgs, ...args];
    this.stack.push({ node: fnNode, mod: f.mod, f });
    try {
      const params = fnNode.params || [];
      for (let i = 0; i < params.length; i++) {
        const p = params[i];
        if (p.type === 'RestElement') {
          this.bind(p.argument, arr(args.slice(i)), scope, 'declare');
          break;
        }
        let v = args[i] || UNDEF;
        const target = p.type === 'TSParameterProperty' ? p.parameter : p;
        const annotated = target.type === 'AssignmentPattern' ? target.left : target;
        if (this.analyzing && this.hooks.onTyped && annotated.typeAnnotation && v.k === 'role') {
          v = this.hooks.onTyped(this, v, annotated.typeAnnotation, scope) || v;
        }
        this.bind(p, v, scope, 'declare');
        if (p.type === 'TSParameterProperty') {
          const name = patternNames(p.parameter)[0];
          if (name && scope.thisVal && scope.thisVal.k === 'o') scope.thisVal.props.set(name, v);
        }
      }
      if (fnNode.body.type !== 'BlockStatement') return this.eval(fnNode.body, scope);
      const frame = new Frame();
      this.execBlock(fnNode.body.body, scope, frame);
      return pickReturn(frame.returns);
    } finally {
      this.stack.pop();
    }
  }

  // --- classes -------------------------------------------------------------------------------

  makeClass(node, scope, mod) {
    const superVal = node.superClass ? this.eval(node.superClass, scope) : null;
    const c = { k: 'c', node, scope, mod, name: node.id ? node.id.name : '', superVal, props: new Map(), proto: obj(), id: 0 };
    if (superVal && superVal.k === 'c') c.proto.proto = superVal.proto;
    const cscope = new Scope(scope, 'class');
    cscope.homeClass = c;
    c.cscope = cscope;
    if (node.id) cscope.declare(node.id.name, c);
    for (const m of node.body.body) {
      if (m.type !== 'ClassMethod' && m.type !== 'ClassPrivateMethod' && m.type !== 'TSDeclareMethod') continue;
      if (m.kind === 'constructor' || !m.body) continue;
      const key = m.key.type === 'Identifier' ? m.key.name : m.key.type === 'PrivateName' ? '#' + m.key.id.name
        : m.key.value !== undefined ? String(m.key.value) : null;
      if (key == null) continue;
      const f = fn(m, cscope, mod, key);
      f.homeClass = c;
      f.isMethod = true;
      if (m.static) c.props.set(key, f);
      else if (m.kind === 'get') { c.proto.getters = c.proto.getters || new Map(); c.proto.getters.set(key, f); } else c.proto.props.set(key, f);
    }
    for (const m of node.body.body) {
      if ((m.type === 'ClassProperty' || m.type === 'ClassPrivateProperty') && m.static && m.value) {
        const s = new Scope(cscope, 'fn');
        s.thisVal = c;
        const key = m.key.name || m.key.value;
        if (key != null) c.props.set(String(key), this.eval(m.value, s));
      }
    }
    return c;
  }

  construct(c, args, node) {
    if (c.superVal && c.superVal.k === 'p' && !this.hasOwnConstructor(c)) {
      const made = this.callValue(c.superVal, args, UNDEF, node, true);
      if (made.k === 'r') return made;
    }
    const inst = obj([], { proto: c.proto, cls: c });
    this.initInstance(c, inst, args);
    if (inst.routerBase) return inst.routerBase;
    return inst;
  }

  hasOwnConstructor(c) {
    return c.node.body.body.some((m) => m.kind === 'constructor');
  }

  initInstance(c, inst, args) {
    if (this.stack.length > MAX_DEPTH) return;
    const ctor = c.node.body.body.find((m) => m.kind === 'constructor');
    const fieldInit = () => {
      for (const m of c.node.body.body) {
        if ((m.type !== 'ClassProperty' && m.type !== 'ClassPrivateProperty' && m.type !== 'ClassAccessorProperty') || m.static) continue;
        const key = m.key.type === 'PrivateName' ? '#' + m.key.id.name : m.key.name || (m.key.value != null ? String(m.key.value) : null);
        if (key == null) continue;
        let v = UNDEF;
        if (m.value) {
          const s = new Scope(c.cscope, 'fn');
          s.thisVal = inst;
          v = this.eval(m.value, s);
          if (v.k === 'f') { if (!v.name) v.name = key; v.boundThis = v.node.type === 'ArrowFunctionExpression' ? undefined : v.boundThis; }
        }
        inst.props.set(key, v);
      }
    };
    if (!ctor) {
      if (c.superVal && c.superVal.k === 'c') this.initInstance(c.superVal, inst, args);
      else if (c.superVal && c.superVal.k === 'p') {
        const made = this.callValue(c.superVal, args, UNDEF, null, true);
        if (made.k === 'r') inst.routerBase = made;
      }
      fieldInit();
      return;
    }
    if (!c.superVal) fieldInit();
    const f = fn(ctor, c.cscope, c.mod, 'constructor');
    f.homeClass = c;
    if (c.superVal) {
      // fields of a derived class are initialised right after super(); approximating: before the body.
      fieldInit();
    }
    this.callFunction(f, args, inst, null);
  }

  protoLookup(proto, key) {
    for (let p = proto; p; p = p.proto) {
      if (p.props.has(key)) return p.props.get(key);
      if (p.getters && p.getters.has(key)) return p.getters.get(key);
    }
    return null;
  }

  withThis(v, self) {
    if (v && v.k === 'f' && v.isMethod) return { ...v, boundThis: self };
    return v || U;
  }

  // --- members -------------------------------------------------------------------------------

  getMember(o, key, node) {
    if (!o) return U;
    const h = this.hooks;
    switch (o.k) {
      case 'o': {
        if (o.nsRec) return this.getExport(o.nsRec, key);
        if (o.props.has(key)) return o.props.get(key);
        if (o.getters && o.getters.has(key)) return this.callFunction(o.getters.get(key), [], o, node);
        if (o.proto) {
          const v = this.protoLookup(o.proto, key);
          if (v) {
            if (o.proto.getters && o.proto.getters.has(key) && v === o.proto.getters.get(key)) return this.callFunction(v, [], o, node);
            return this.withThis(v, o);
          }
        }
        if (o.proxyOf) return this.getMember(o.proxyOf, key, node);
        if (o.isEnv) return UNDEF;
        if (o.spreadRole && h.roleGet) return h.roleGet(this, o.spreadRole, key) || U;
        if (key === 'length' && o.mapEntries) return num(o.mapEntries.length);
        return unknown(key);
      }
      case 'a':
        if (key === 'length') return num(o.items.length);
        if (/^\d+$/.test(key)) return o.items[Number(key)] || UNDEF;
        return unknown(key);
      case 's':
        if (key === 'length') return num(o.v.length);
        if (/^\d+$/.test(key)) return o.v[Number(key)] !== undefined ? str(o.v[Number(key)]) : UNDEF;
        return unknown(key);
      case 'c':
        if (o.props.has(key)) return o.props.get(key);
        if (key === 'name') return str(o.name);
        if (key === 'prototype') return o.proto;
        if (o.superVal && o.superVal.k === 'c') return this.getMember(o.superVal, key, node);
        return unknown(key);
      case 'f':
        if (o.props && o.props.has(key)) return o.props.get(key);
        if (key === 'name') return str(o.name || '');
        return unknown(key);
      case 'p': {
        const v = h.pkgGet ? h.pkgGet(this, o, key, node) : undefined;
        return v || pkgGet(o, key);
      }
      case 'r': {
        const v = h.routerGet ? h.routerGet(this, o, key, node) : undefined;
        if (v) return v;
        if (o.props && o.props.has(key)) return o.props.get(key);
        return unknown(key);
      }
      case 'z': {
        const v = h.schemaGet ? h.schemaGet(this, o, key) : undefined;
        return v || U;
      }
      case 'role': {
        const v = h.roleGet ? h.roleGet(this, o, key, node) : undefined;
        return v || U;
      }
      case 'u':
        return unknown(o.name ? `${o.name}.${key}` : key);
      default:
        return U;
    }
  }

  // --- builtins ------------------------------------------------------------------------------

  stringMethod(s, key, args) {
    const a = args.map((x) => (x.k === 's' || x.k === 'n' || x.k === 'b' ? x.v : x.k === 're' ? x : undefined));
    if (!STRING_METHODS.has(key)) return U;
    const v = s.v;
    try {
      switch (key) {
        case 'replace':
        case 'replaceAll': {
          if (a[1] === undefined) return U;
          if (a[0] && a[0].k === 're') {
            if (a[0].source.length > 200) return U;
            return str(v[key](new RegExp(a[0].source, a[0].flags), String(a[1])));
          }
          if (typeof a[0] !== 'string') return U;
          return str(v[key](a[0], String(a[1])));
        }
        case 'split': {
          if (a[0] && a[0].k === 're') return arr(v.split(new RegExp(a[0].source, a[0].flags)).map(str));
          if (typeof a[0] !== 'string') return U;
          return arr(v.split(a[0]).map(str));
        }
        case 'match':
        case 'search':
          return U;
        default: {
          if (a.some((x, i) => x === undefined && i < args.length)) return U;
          const r = v[key](...a);
          if (typeof r === 'string') return str(r);
          if (typeof r === 'number') return num(r);
          if (typeof r === 'boolean') return bool(r);
          return U;
        }
      }
    } catch {
      return U;
    }
  }

  arrayMethod(a, key, args, node) {
    const cb = args[0];
    const call = (item, i) => (cb && (cb.k === 'f' || cb.k === 'nf') ? this.callValue(cb, [item, num(i), a], UNDEF, node) : U);
    const items = a.items.slice(0, MAX_LOOP);
    switch (key) {
      case 'forEach': items.forEach(call); return UNDEF;
      case 'map': return arr(items.map(call));
      case 'flatMap': return arr(items.flatMap((x, i) => { const r = call(x, i); return r.k === 'a' ? r.items : [r]; }));
      case 'filter': return arr(items.filter((x, i) => truthy(call(x, i)) !== false));
      case 'find': { for (let i = 0; i < items.length; i++) if (truthy(call(items[i], i)) === true) return items[i]; return items.length ? U : UNDEF; }
      case 'some': case 'every': items.forEach(call); return U;
      case 'reduce': {
        let acc = args.length > 1 ? args[1] : items[0] || UNDEF;
        const start = args.length > 1 ? 0 : 1;
        for (let i = start; i < items.length; i++) {
          if (cb && cb.k === 'f') acc = this.callFunction(cb, [acc, items[i], num(i), a], UNDEF, node);
        }
        return acc;
      }
      case 'concat': return arr([...a.items, ...args.flatMap((x) => (x.k === 'a' ? x.items : [x]))]);
      case 'flat': return arr(a.items.flatMap((x) => (x.k === 'a' ? x.items : [x])));
      case 'push': case 'unshift': a.items[key](...args); return num(a.items.length);
      case 'slice': return arr(a.items.slice(...args.map((x) => (x.k === 'n' ? x.v : undefined))));
      case 'reverse': return arr([...a.items].reverse());
      case 'sort': case 'toSorted': return a;
      case 'join': {
        const sep = args[0] && args[0].k === 's' ? args[0].v : ',';
        if (a.items.every((x) => x.k === 's' || x.k === 'n')) return str(a.items.map((x) => x.v).join(sep));
        return U;
      }
      case 'includes': case 'indexOf': {
        // ALLOWED.includes(req.body.role): the allowed values of a field
        const v = args[0];
        if (this.analyzing && v && v.k === 'role' && v.role === 'field' && v.path.length && a.items.length && a.items.every((x) => x.k === 's' || x.k === 'n')) {
          const node = this.analyzing.touch(v.loc, v.path);
          if (node) for (const x of a.items) node.choices.add(x.v);
        }
        return U;
      }
      case 'at': return args[0] && args[0].k === 'n' ? a.items.at(args[0].v) || UNDEF : U;
      case 'keys': return arr(a.items.map((_, i) => num(i)));
      case 'values': return a;
      case 'entries': return arr(a.items.map((x, i) => arr([num(i), x])));
      default: return null;
    }
  }
}

/** verifyToken(req.body.refreshToken): a token sent as data, not credentials of the request. */
function fromRequestData(args) {
  return args.some((a) => a && a.k === 'role' && a.role === 'field' && a.path.length && (a.loc === 'body' || a.loc === 'query' || a.loc === 'form' || a.loc === 'input'));
}

export function patternNames(p) {
  if (!p) return [];
  switch (p.type) {
    case 'Identifier': return [p.name];
    case 'AssignmentPattern': return patternNames(p.left);
    case 'RestElement': return patternNames(p.argument);
    case 'ObjectPattern': return p.properties.flatMap((x) => patternNames(x.type === 'RestElement' ? x : x.value));
    case 'ArrayPattern': return p.elements.flatMap((x) => patternNames(x));
    case 'TSParameterProperty': return patternNames(p.parameter);
    default: return [];
  }
}

/** Best guess of what an abstractly executed function returns. */
export function pickReturn(values) {
  if (!values.length) return UNDEF;
  const router = values.filter((v) => v.k === 'r');
  if (router.length) return router[router.length - 1];
  return values.find((v) => v.k !== 'u' && v.k !== 'undef' && v.k !== 'null') || values[0];
}

function typeOf(v) {
  switch (v.k) {
    case 's': return str('string');
    case 'n': return str('number');
    case 'b': return str('boolean');
    case 'undef': return str('undefined');
    case 'f': case 'nf': case 'c': return str('function');
    case 'o': case 'a': case 'null': return str('object');
    default: return U;
  }
}

export { Scope, Frame };
