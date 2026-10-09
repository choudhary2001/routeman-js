#!/usr/bin/env node
// routeman CLI entry point (works with node, bun and deno).
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 18 || (major === 18 && minor < 3)) {
  console.error(`routeman needs Node.js 18.3 or newer (found ${process.versions.node}).`);
  process.exit(1);
}
import('../src/cli.js').then(({ main }) => main()).then((code) => {
  process.exitCode = code;
}, (err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
