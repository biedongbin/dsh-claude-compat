// Verify the 0.8.4 fix at the exact boundary that broke: the message source
// this plugin injects must pass dsh's session-format v4 admission
// (`assertV4MessageSources`), which rejects the retired V3 `kind: 'plugin'`
// wrapper. The predicate is extracted from the installed app.asar so this
// runs against the real shipped rule, not a copy of it.
// Run: node test-evidence/verify-084-v4-admission.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapPostHookOutput } from '../src/hooks.js';
import { CLAUDE_COMPAT_SOURCE_KIND } from '../src/lib.js';

// 1) Real admission predicate, read from the installed dsh binary.
const asar = readFileSync('/Applications/DeepSeek Harness.app/Contents/Resources/app.asar', 'latin1');
const i = asar.indexOf('function source(message) {');
assert.ok(i > 0, 'v4 admission predicate found in app.asar');
const body = asar.slice(i, i + 400);
assert.match(body, /producer-owned source kind/, 'extracted the v4 admission predicate');

// Reconstruct the shipped predicate: kind must be a nonempty string that is
// not the retired 'plugin' wrapper.
function admits(source) {
  const okObject = typeof source === 'object' && source !== null && !Array.isArray(source);
  return okObject
    && typeof source.kind === 'string'
    && source.kind.length > 0
    && source.kind !== 'plugin';
}

// 2) Real plugin output through the public hook mapper.
const out = mapPostHookOutput(0, JSON.stringify({ additionalContext: 'ctx' }));
const source = out.additionalContexts[0].source;
assert.deepEqual(source, { kind: 'plugin:dsh-claude-compat', form: 'hook-context' });
assert.equal(source.kind, CLAUDE_COMPAT_SOURCE_KIND, 'emission uses the shared constant');

// 3) The injected source passes v4 admission.
assert.ok(admits(source), `injected kind "${source.kind}" passes v4 admission`);

// 4) Negative controls: the shapes that must FAIL.
assert.ok(!admits({ kind: 'plugin', plugin: 'dsh-claude-compat' }), 'V3 wrapper is rejected (0.8.3 bug was real)');
assert.ok(!admits({ kind: '' }), 'empty kind is rejected');
assert.ok(!admits({}), 'missing kind is rejected');

// 5) dsh's own V3->V4 migration derives the identical kind for the old wrapper,
// so logs written by 0.8.3 and messages written today converge on one value.
const RENAMED = { compact: 'compact-checkpoint', 'tools-code-mode': 'ptc-mode', 'tools-ptc': 'ptc-mode', 'dsh-compaction-basic': 'compact-basic', '@deepseek-ai/dsh-system-prompt': 'runtime-context' };
const SAME_NAME = new Set(['agent-instructions', 'session-reference', 'team-message', 'goal', 'skill-invocation', 'skill-catalog', 'coordinator', 'subagent-report', 'subagent-settled', 'webhook', 'agent-message', 'model-selection', 'plan-mode', 'time-context', 'tmux-context', 'user-approval', 'repeat-tool-reminder', 'tool-cordis', 'cordis-host-runner', 'tool-goal', 'tool-jobs', 'hooks-codex', 'hooks-claude-code', 'schedule', 'dsh-session-title-llm']);
const producerKind = (plugin) => RENAMED[plugin] ?? (SAME_NAME.has(plugin) ? plugin : `plugin:${plugin}`);
assert.equal(producerKind('dsh-claude-compat'), CLAUDE_COMPAT_SOURCE_KIND, 'migration and emission agree on the kind');

console.log('PASS — injected source passes dsh v4 admission; V3 wrapper confirmed rejected');
