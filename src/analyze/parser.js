// Source -> AST with the vendored @babel/parser (no runtime dependencies).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const babel = require('../../vendor/babel-parser.cjs');

const MAX_FILE_BYTES = 2 * 1024 * 1024; // larger files are bundles or generated code

const BASE = {
  sourceType: 'module',
  allowImportExportEverywhere: true,
  allowReturnOutsideFunction: true,
  allowAwaitOutsideFunction: true,
  allowUndeclaredExports: true,
  allowSuperOutsideMethod: true,
  allowNewTargetOutsideFunction: true,
  errorRecovery: true,
  attachComment: true,
};

function pluginsFor(file, variant) {
  const ts = /\.(c|m)?tsx?$/.test(file);
  const tsx = /\.tsx$/.test(file);
  const common = ['decorators-legacy', 'importAttributes', 'explicitResourceManagement', 'doExpressions',
    'exportDefaultFrom', 'functionBind', 'throwExpressions', 'partialApplication', 'regexpUnicodeSets'];
  if (ts || variant === 'ts') return [['typescript', { dts: /\.d\.(c|m)?ts$/.test(file) }], ...(tsx || variant === 'ts' ? ['jsx'] : []), ...common];
  if (variant === 'flow') return ['flow', 'jsx', ...common];
  return ['jsx', ...common];
}

/**
 * Parse a file. Returns null (and a reason) when the file is not JavaScript we can read.
 * @returns {{ ast: object|null, error: string|null }}
 */
export function parse(code, file) {
  if (code.length > MAX_FILE_BYTES) return { ast: null, error: 'file is too large to analyse' };
  if (code.charCodeAt(0) === 0xfeff) code = code.slice(1);
  if (code.startsWith('#!')) code = '//' + code.slice(2);
  // .js files sometimes contain TypeScript (ts-node with allowJs) or Flow; try those next.
  const variants = /\.(c|m)?tsx?$/.test(file) ? [null] : [null, 'ts', 'flow'];
  let firstError = null;
  for (const variant of variants) {
    try {
      const ast = babel.parse(code, { ...BASE, plugins: pluginsFor(file, variant) });
      return { ast, error: null };
    } catch (err) {
      firstError = firstError || err;
    }
  }
  return { ast: null, error: firstError ? firstError.message : 'parse error' };
}
