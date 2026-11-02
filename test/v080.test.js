// Hook payload fidelity and the source kind of injected hook context.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupport } from '../src/hook-support.js';
import { CLAUDE_COMPAT_SOURCE_KIND } from '../src/lib.js';

// dsh session format v4 admission refuses `kind: 'plugin'`, the retired V3 wrapper,
// and requires a producer-owned kind. A session with .claude/rules failed admission
// when the wrapper was emitted.
test('injected context source is producer-owned, never the retired V3 plugin wrapper', () => {
  const message = createSupport({}).contextMessage('ctx');
  const { source } = message;
  assert.equal(source.kind, CLAUDE_COMPAT_SOURCE_KIND);
  assert.equal(source.kind, 'plugin:dsh-claude-compat');
  assert.equal(source.plugin, undefined, 'the plugin field is retired with the wrapper');
  assert.equal(message.content[0].text, 'ctx');
});

const agent = { session: { id: 'ignored', header: { id: 'session-test-123', cwd: '/proj/sub' } } };

test('payload reads the session id and cwd from the agent session header', () => {
  const payload = createSupport({}).payload('SessionStart', agent, { source: 'startup' });
  assert.equal(payload.session_id, 'session-test-123');
  assert.equal(payload.cwd, '/proj/sub');
  assert.equal(payload.hook_event_name, 'SessionStart');
  assert.equal(payload.source, 'startup');
});

test('payload cwd comes from the working-directory service when DSH has one', () => {
  const ctx = { workingDirectory: { get: (session) => (session === agent.session ? '/moved' : undefined) } };
  assert.equal(createSupport(ctx).payload('Stop', agent).cwd, '/moved');
});

test('payload with no agent falls back to the process cwd and an empty session id', () => {
  const payload = createSupport({}).payload('SessionEnd', undefined);
  assert.equal(payload.session_id, '');
  assert.equal(payload.cwd, process.cwd());
});

test('inject adds each context to the agent, and does nothing without an agent', () => {
  const injected = [];
  const support = createSupport({});
  support.inject({ inject: (message) => injected.push(message) }, { contexts: ['a', 'b'] });
  assert.equal(injected.length, 2);
  support.inject(undefined, { contexts: ['a'] });
});
