// Failure paths and limits: separate stderr, output caps, http redirects, background hook
// errors, bounded state, and malformed DSH input.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runHookCommand, runHttpHook } from '../src/hook-handlers.js';
import { createWatcher } from '../src/hook-watch.js';
import { HOOK_CALL_PREFIX } from '../src/hook-support.js';
import { fakeAgent, harness, say, tempDir, withWarnings } from './hook-kit.js';

const plain = (command, extra = {}) => ({ type: 'command', command, projectDir: '/tmp', ...extra });
const allow = async () => ({ kind: 'allow' });
const call = (name, agent) => ({ name, arguments: {}, callId: 'c1', agent });

// ─── command output ──────────────────────────────────────────────────────────

test('stdout and stderr are kept apart', async () => {
  const run = await runHookCommand(plain('echo out; echo err >&2'), '', {});
  assert.deepEqual([run.stdout, run.stderr], ['out\n', 'err\n']);
});

test('a hook that prints a JSON decision and a warning on stderr still decides', async () => {
  const command = `echo 'warning: old' >&2; ${say({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'no' } })}`;
  const h = harness({ PreToolUse: [{ matcher: '.*', hooks: [{ command }] }] });
  assert.deepEqual(await h.dispatch('tools/pre-execute', [call('Bash', fakeAgent())], allow), { kind: 'deny', reason: 'no' });
});

test('each output stream is cut at the limit', async () => {
  const run = await runHookCommand(plain("head -c 3000000 /dev/zero | tr '\\0' a; head -c 3000000 /dev/zero | tr '\\0' b >&2"), '', {});
  assert.equal(run.stdout.length, 1_048_576);
  assert.equal(run.stderr.length, 1_048_576);
  assert.equal(run.exitCode, 0);
});

test('shell bash runs the command in bash, and the default is sh', async () => {
  assert.equal((await runHookCommand(plain('printf %s "$0"', { shell: 'bash' }), '', {})).stdout, '/bin/bash');
  assert.equal((await runHookCommand(plain('printf %s "$0"'), '', {})).stdout, '/bin/sh');
});

// ─── http limits ─────────────────────────────────────────────────────────────

const httpHook = { type: 'http', url: 'https://example.test/hook' };

test('http does not follow a redirect, and a redirect is a failed run', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(init.redirect);
    return { status: 302, text: async () => '' };
  };
  const run = await runHttpHook(httpHook, '{}', { fetchImpl });
  assert.deepEqual([seen[0], run.failed, run.reason], ['manual', true, 'http 302']);
});

test('http fails on a response body over the limit', async () => {
  const fetchImpl = async () => ({ status: 200, text: async () => '{'.padEnd(1_048_577, ' ') });
  const run = await runHttpHook(httpHook, '{}', { fetchImpl });
  assert.equal(run.failed, true);
  assert.match(run.reason, /response body is too large/);
});

// ─── engine ──────────────────────────────────────────────────────────────────

test('an asyncRewake hook whose steer throws is logged, not an unhandled rejection', async () => {
  const agent = fakeAgent();
  agent.steer = () => { throw new Error('agent is gone'); };
  const h = harness({ PreToolUse: [{ matcher: '.*', hooks: [{ command: 'echo wake >&2; exit 2', asyncRewake: true }] }] });
  const { warnings } = await withWarnings(async () => {
    await h.dispatch('tools/pre-execute', [call('Read', agent)], allow);
    await h.drain();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  assert.match(warnings.join('\n'), /async PreToolUse hook failed: agent is gone/);
});

test('a runner that throws is a failed run, and the DSH event goes on', async () => {
  const runners = { command: async () => { throw new Error('runner bug'); } };
  const h = harness({ PreToolUse: [{ matcher: '.*', hooks: [{ command: 'x', onFailure: 'block' }] }] }, { runners });
  const { value, warnings } = await withWarnings(() => h.dispatch('tools/pre-execute', [call('Read', fakeAgent())], allow));
  assert.equal(value.kind, 'deny');
  assert.match(warnings.join('\n'), /hook runner error: runner bug/);
});

test('an unknown permissionDecision is logged and the call is not denied or allowed by it', async () => {
  const h = harness({ PreToolUse: [{ matcher: '.*', hooks: [{ command: say({ hookSpecificOutput: { permissionDecision: 'Deny' } }) }] }] });
  const { value, warnings } = await withWarnings(() => h.dispatch('tools/pre-execute', [call('Read', fakeAgent())], allow));
  assert.equal(value.kind, 'allow');
  assert.match(warnings.join('\n'), /hook output ignored: permissionDecision "Deny" is not allow, deny, ask or defer/);
});

// ─── bridges ─────────────────────────────────────────────────────────────────

test('a PermissionRequest decision with an unknown behavior is logged and ignored', async () => {
  const command = say({ hookSpecificOutput: { decision: { behavior: 'maybe' } } });
  const h = harness({ PermissionRequest: [{ matcher: '.*', hooks: [{ command }] }] });
  const agent = fakeAgent();
  await h.dispatch('tools/pre-execute', [call('Bash', agent)], allow);
  const { value, warnings } = await withWarnings(() => h.dispatch('approval/request', [{ agent, toolName: 'Bash', callId: 'c1' }], async () => 'cancelled'));
  assert.equal(value, 'cancelled');
  assert.match(warnings.join('\n'), /behavior "maybe", not allow or deny/);
});

test('an approval with no recorded call input is logged', async () => {
  const h = harness({ PermissionRequest: [{ matcher: '.*', hooks: [{ command: 'true' }] }] });
  const { warnings } = await withWarnings(() => h.dispatch('approval/request', [{ agent: fakeAgent(), toolName: 'Bash', callId: 'lost' }], async () => 'allowed-once'));
  assert.match(warnings.join('\n'), /no input is known for the approval of Bash/);
});

test('the approval of a tool call that a hook made does not run PermissionRequest hooks', async () => {
  const file = join(tempDir('dcc-hard-'), 'ran');
  const h = harness({ PermissionRequest: [{ matcher: '.*', hooks: [{ command: `echo ran >> "${file}"; ${say({ hookSpecificOutput: { decision: { behavior: 'allow' } } })}` }] }] });
  const answer = await h.dispatch('approval/request', [{ agent: fakeAgent(), toolName: 'mcp__s__t', callId: `${HOOK_CALL_PREFIX}1` }], async () => 'rejected');
  assert.equal(answer, 'rejected');
  assert.throws(() => readFileSync(file), /ENOENT/);
});

test('todo_write arguments with no todos list are logged', async () => {
  const h = harness({ TaskCreated: [{ hooks: [{ command: 'true' }] }] });
  const { value, warnings } = await withWarnings(() => h.dispatch('tools/pre-execute', [{ name: 'todo_write', arguments: { todos: 'nope' }, callId: 'c', agent: fakeAgent() }], allow));
  assert.equal(value.kind, 'allow');
  assert.match(warnings.join('\n'), /todo_write arguments have no todos list/);
});

test('a team/member event with no member does not throw, and a blocked teammate with no steer does not throw', async () => {
  const h = harness({ TeammateIdle: [{ hooks: [{ command: 'exit 2' }] }] });
  await h.dispatch('session/event', [{ id: 'lead', header: { id: 'lead' } }, { type: 'team/member', seq: 1, time: 0, data: {} }], () => {});
  await h.dispatch('session/event', [{ id: 'lead', header: { id: 'lead' } }, { type: 'team/member', seq: 2, time: 0, data: { teamId: 't', member: { id: 'm1', name: 'n' } } }], () => {});
  const mate = { session: { header: { id: 'm1' } }, inject() {} };
  h.dispatch('agent/status', [{ agent: mate, status: 'running' }], () => {});
  h.dispatch('agent/status', [{ agent: mate, status: 'idle' }], () => {});
  await h.drain();
  assert.ok(true);
});

test('a subagent that is not in the agent registry is logged, and its hook still runs', async () => {
  const file = join(tempDir('dcc-hard-'), 'ran');
  const ctx = { get: () => ({ get: () => undefined }) };
  const h = harness({ SubagentStart: [{ hooks: [{ command: `echo ran >> "${file}"` }] }] }, { ctx });
  const { warnings } = await withWarnings(async () => {
    h.dispatch('subagent/start', [{ runId: 'r', provider: 'p', id: 'ghost', local: true }], () => {});
    await h.drain();
  });
  assert.match(warnings.join('\n'), /subagent ghost is not in the agent registry/);
  assert.equal(readFileSync(file, 'utf8').trim(), 'ran');
});

test('MessageDisplay: one failed batch does not stop the batches after it', async () => {
  const file = join(tempDir('dcc-hard-'), 'lines');
  let calls = 0;
  const runners = {
    command: async (_hook, payload) => {
      calls += 1;
      if (calls === 1) throw new Error('first batch broke');
      writeFileSync(file, `${readFileSync(file, 'utf8').toString()}${JSON.parse(payload).delta}`, { flag: 'a' });
      return { exitCode: 0, stdout: '', stderr: '', failed: false };
    },
  };
  writeFileSync(file, '');
  const h = harness({ MessageDisplay: [{ hooks: [{ command: 'x' }] }] }, { runners });
  const agent = fakeAgent();
  const frames = [{ type: 'start', turn: 1, step: 0 }, { type: 'chunk', chunk: { type: 'text-delta', text: 'one\ntwo\n' } }, { type: 'chunk', chunk: { type: 'text-delta', text: 'three\n' } }, { type: 'end', outcome: { kind: 'committed' } }];
  await withWarnings(async () => {
    for (const frame of frames) h.dispatch('agent/assistant-stream', [{ agent, frame }], () => {});
    await h.drain();
  });
  assert.ok(readFileSync(file, 'utf8').includes('three'));
});

// ─── state is dropped when an agent is disposed ──────────────────────────────

test('a disposed session starts again: the model baseline, the Stop count and the todo baseline are gone', async () => {
  const log = join(tempDir('dcc-hard-'), 'lines');
  const h = harness({
    PostModelSwitch: [{ hooks: [{ command: `echo switch >> "${log}"` }] }],
    TaskCreated: [{ hooks: [{ command: `echo created >> "${log}"` }] }],
  });
  const agent = fakeAgent('s-gone');
  const step = (model) => ({ agent, messages: [], modelSelection: { provider: 'p', model } });
  const enter = async () => ({ kind: 'enter', messages: [] });
  await h.dispatch('agent/pre-step', [step('a')], enter);
  await h.dispatch('agent/pre-step', [step('b')], enter);
  const todo = { name: 'todo_write', arguments: { todos: [{ content: 'x', status: 'pending' }] }, callId: 'c', agent };
  await h.dispatch('tools/pre-execute', [todo], allow);
  await h.dispatch('tools/post-execute', [todo, { isError: false, content: [] }], async () => ({ kind: 'accept' }));
  await h.dispatch('agent/disposed', [{ agent }], () => {});
  await h.dispatch('agent/pre-step', [step('c')], enter);
  await h.dispatch('tools/pre-execute', [todo], allow);
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  assert.deepEqual(lines, ['switch', 'created', 'created'], 'no switch for c, and x is new again');
});

test('a disposed session loses its unreported tool results', async () => {
  const log = join(tempDir('dcc-hard-'), 'lines');
  const h = harness({ PostToolBatch: [{ hooks: [{ command: `echo batch >> "${log}"` }] }] });
  const agent = fakeAgent('s-batch');
  await h.dispatch('tools/post-execute', [call('Read', agent), { isError: false, value: 'x', content: [] }], async () => ({ kind: 'accept' }));
  await h.dispatch('agent/disposed', [{ agent }], () => {});
  await h.dispatch('agent/pre-step', [{ agent, messages: [] }], async () => ({ kind: 'enter', messages: [] }));
  assert.throws(() => readFileSync(log), /ENOENT/);
});

// ─── watcher failures ────────────────────────────────────────────────────────

test('a handler that throws does not stop the poll for the other files', () => {
  const dir = tempDir('dcc-hard-');
  const [a, b] = [join(dir, 'a'), join(dir, 'b')];
  const seen = [];
  const { warnings } = { warnings: [] };
  const original = console.warn;
  console.warn = (message) => warnings.push(message);
  const watcher = createWatcher({
    onChange: (path) => {
      seen.push(path);
      if (path === a) throw new Error('boom');
    },
    intervalMs: 1_000_000,
  });
  try {
    watcher.set('t', [a, b]);
    writeFileSync(a, '1');
    writeFileSync(b, '1');
    watcher.poll();
  } finally {
    console.warn = original;
    watcher.close();
  }
  assert.deepEqual(seen.sort(), [a, b]);
  assert.match(warnings[0], /file watch handler failed for .*a: boom/);
});

test('a file that cannot be read now is not reported as removed', () => {
  const dir = tempDir('dcc-hard-');
  const locked = join(dir, 'locked');
  mkdirSync(locked);
  const file = join(locked, 'a.txt');
  writeFileSync(file, 'x');
  const seen = [];
  const watcher = createWatcher({ onChange: (path, event) => seen.push([path, event]), intervalMs: 1_000_000 });
  watcher.set('t', [file]);
  chmodSync(locked, 0o000);
  try {
    watcher.poll();
  } finally {
    chmodSync(locked, 0o755);
  }
  watcher.poll();
  watcher.close();
  assert.deepEqual(seen, [], 'neither an unlink nor a change');
});
