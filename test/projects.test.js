// Every test project in test/projects with an expected.json must be analysed exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare } from './compare.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'projects');
for (const name of fs.readdirSync(DIR).sort()) {
  const dir = path.join(DIR, name);
  if (!fs.existsSync(path.join(dir, 'expected.json'))) continue;
  test(`project ${name}`, () => {
    const { problems } = compare(dir);
    assert.deepEqual(problems, []);
  });
}
