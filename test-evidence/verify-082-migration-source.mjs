// Verify 0.8.2 fix end-to-end at the exact boundary that broke:
// the message source written into session.jsonl must pass dsh's
// SOURCE_KINDS migration whitelist (read from the installed app.asar).
// Negative control proves the check catches the old custom kind.
// Run: node test-evidence/verify-082-migration-source.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapPostHookOutput } from '../src/hooks.js';

// 1) Real whitelist, read from the installed dsh binary (not a copy).
const asar = readFileSync('/Applications/DeepSeek Harness.app/Contents/Resources/app.asar', 'latin1');
const i = asar.indexOf('SOURCE_KINDS = new Set([');
assert.ok(i > 0, 'SOURCE_KINDS found in app.asar');
const WHITELIST = new Set([...asar.slice(i, i + 400).matchAll(/"([a-z-]+)"/g)].map((m) => m[1]));
assert.ok(WHITELIST.size >= 15, `whitelist parsed: ${[...WHITELIST].join(',')}`);

// 2) Real plugin output through the public hook mapper.
const out = mapPostHookOutput(0, JSON.stringify({ additionalContext: 'ctx' }));
const src = out.additionalContexts[0].source;
assert.deepEqual(src, { kind: 'plugin', plugin: 'dsh-claude-compat', form: 'hook-context' });

// 3) Serialized exactly as dsh persists a user/message event.
const line = JSON.stringify({
  type: 'user/message', seq: 1, time: 0,
  data: { role: 'user', id: 'x', content: out.additionalContexts[0].content, source: src },
});
const persisted = JSON.parse(line).data.source;
assert.ok(WHITELIST.has(persisted.kind), `persisted kind "${persisted.kind}" passes migration whitelist`);

// 4) Negative control: the old custom kind must FAIL the whitelist.
assert.ok(!WHITELIST.has('claude-compat'), 'old kind claude-compat is rejected by the whitelist (bug was real)');

console.log('PASS — plugin-injected source passes dsh migration whitelist; old kind confirmed rejected');
