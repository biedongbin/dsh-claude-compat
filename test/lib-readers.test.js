import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTextSafeSync, readTextSafe } from '../src/lib.js';

// Regression: readTextSafeSync referenced `readFileSync` without importing it,
// so every call threw ReferenceError, the empty catch turned it into
// `undefined`, and callers silently saw "no file" — which zeroed out plugin MCP
// and hook detection for months without a single error in the logs.
test('readTextSafeSync reads an existing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dcc-lib-'));
  const file = join(dir, 'a.json');
  writeFileSync(file, '{"ok":true}');
  assert.equal(readTextSafeSync(file), '{"ok":true}');
  rmSync(dir, { recursive: true, force: true });
});

test('readTextSafeSync returns undefined only for genuinely absent paths', () => {
  assert.equal(readTextSafeSync('/definitely/not/here/x.json'), undefined);
});

test('readTextSafe reads an existing file and tolerates a missing one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dcc-lib-'));
  const file = join(dir, 'b.txt');
  writeFileSync(file, 'hello');
  assert.equal(await readTextSafe(file), 'hello');
  assert.equal(await readTextSafe(join(dir, 'missing.txt')), undefined);
  rmSync(dir, { recursive: true, force: true });
});
