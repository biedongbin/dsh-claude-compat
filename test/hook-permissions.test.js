// PermissionRequest, PermissionDenied, PostToolBatch and asyncRewake bridges.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeAgent, harness, say, tempDir, textOf, waitFor, withWarnings } from './hook-kit.js';

const ASK = { matcher: '.*' };
const approval = (agent, extra = {}) => ({ agent, toolName: 'Bash', callId: 'c1', ...extra });
const exec = (agent, extra = {}) => ({ name: 'Bash', arguments: { command: 'ls' }, callId: 'c1', agent, ...extra });
const allowTool = async () => ({ kind: 'allow' });
const ok = (value) => ({ isError: false, value, content: [{ type: 'text', text: 'out' }] });
const failed = () => ({ isError: true, error: { code: 'FAILED' }, content: [{ type: 'text', text: 'it broke' }] });
const decide = (decision) => say({ hookSpecificOutput: { decision } });

// ─── PermissionRequest ───────────────────────────────────────────────────────

test('PermissionRequest: an allow decision answers the request without asking next()', async () => {
  const h = harness({ PermissionRequest: [{ ...ASK, hooks: [{ command: decide({ behavior: 'allow' }) }] }] });
  let asked = false;
  const answer = await h.dispatch('approval/request', [approval(fakeAgent())], async () => { asked = true; return 'rejected'; });
  assert.equal(answer, 'allowed-once');
  assert.equal(asked, false);
});

test('PermissionRequest: a deny decision rejects and logs its message', async () => {
  const h = harness({ PermissionRequest: [{ ...ASK, hooks: [{ command: decide({ behavior: 'deny', message: 'no way' }) }] }] });
  const { value, warnings } = await withWarnings(() => h.dispatch('approval/request', [approval(fakeAgent())], async () => 'allowed-once'));
  assert.equal(value, 'rejected');
  assert.match(warnings[0], /denied Bash: no way/);
});

test('PermissionRequest: exit 2 is not honored, so the request goes on to next()', async () => {
  const h = harness({ PermissionRequest: [{ ...ASK, hooks: [{ command: 'exit 2' }] }] });
  assert.equal(await h.dispatch('approval/request', [approval(fakeAgent())], async () => 'allowed-once'), 'allowed-once');
});

test('PermissionRequest: no decision, and a decision with an unknown behavior, go on to next()', async () => {
  for (const command of ['exit 0', decide({ behavior: 'maybe' }), 'printf "not json"']) {
    const h = harness({ PermissionRequest: [{ ...ASK, hooks: [{ command }] }] });
    assert.equal(await h.dispatch('approval/request', [approval(fakeAgent())], async () => 'cancelled'), 'cancelled', command);
  }
});

test('PermissionRequest: onFailure block rejects when the hook fails', async () => {
  const h = harness({ PermissionRequest: [{ ...ASK, hooks: [{ command: 'exit 5', onFailure: 'block' }] }] });
  const { value, warnings } = await withWarnings(() => h.dispatch('approval/request', [approval(fakeAgent())], async () => 'allowed-once'));
  assert.equal(value, 'rejected');
  assert.match(warnings.join('\n'), /hook failed \(exit 5\)/);
});

test('PermissionRequest: without onFailure a failed hook goes on to next()', async () => {
  const h = harness({ PermissionRequest: [{ ...ASK, hooks: [{ command: 'exit 5' }] }] });
  const { value } = await withWarnings(() => h.dispatch('approval/request', [approval(fakeAgent())], async () => 'allowed-once'));
  assert.equal(value, 'allowed-once');
});

test('PermissionRequest: stdin has the tool input recorded for the call id, and an empty suggestion list', async () => {
  const file = join(tempDir('dcc-perm-'), 'stdin.json');
  const h = harness({ PermissionRequest: [{ ...ASK, hooks: [{ command: `cat > "${file}"` }] }] });
  const agent = fakeAgent('s8', '/p');
  await h.dispatch('tools/pre-execute', [exec(agent)], async () => ({ kind: 'ask' }));
  await h.dispatch('approval/request', [approval(agent)], async () => 'allowed-once');
  const payload = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(payload.hook_event_name, 'PermissionRequest');
  assert.deepEqual(payload.tool_input, { command: 'ls' });
  assert.deepEqual(payload.permission_suggestions, []);
  assert.equal(payload.session_id, 's8');
});

test('PermissionRequest: an unrecorded call id sends an empty input, not a crash', async () => {
  const file = join(tempDir('dcc-perm-'), 'stdin.json');
  const h = harness({ PermissionRequest: [{ ...ASK, hooks: [{ command: `cat > "${file}"` }] }] });
  await h.dispatch('approval/request', [approval(fakeAgent(), { callId: undefined })], async () => 'allowed-once');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).tool_input, {});
});

test('PermissionRequest: an if rule reads the recorded input', async () => {
  const h = harness({ PermissionRequest: [{ matcher: 'Bash', hooks: [{ if: 'Bash(git *)', command: decide({ behavior: 'allow' }) }] }] });
  const agent = fakeAgent();
  await h.dispatch('tools/pre-execute', [exec(agent, { callId: 'g', arguments: { command: 'git status' } })], allowTool);
  await h.dispatch('tools/pre-execute', [exec(agent, { callId: 'n', arguments: { command: 'npm test' } })], allowTool);
  assert.equal(await h.dispatch('approval/request', [approval(agent, { callId: 'g' })], async () => 'rejected'), 'allowed-once');
  assert.equal(await h.dispatch('approval/request', [approval(agent, { callId: 'n' })], async () => 'rejected'), 'rejected');
});

test('PermissionRequest: updatedInput is warned, because DSH tool input cannot change', async () => {
  const h = harness({ PermissionRequest: [{ ...ASK, hooks: [{ command: decide({ behavior: 'allow', updatedInput: { command: 'x' } }) }] }] });
  const { value, warnings } = await withWarnings(() => h.dispatch('approval/request', [approval(fakeAgent())], async () => 'rejected'));
  assert.equal(value, 'allowed-once');
  assert.match(warnings[0], /cannot be changed/);
});

// ─── PermissionDenied ────────────────────────────────────────────────────────

test('PermissionDenied runs when the approval is rejected, with the reason', async () => {
  const file = join(tempDir('dcc-denied-'), 'stdin.json');
  const h = harness({ PermissionDenied: [{ ...ASK, hooks: [{ command: `cat > "${file}"` }] }] });
  await h.dispatch('approval/request', [approval(fakeAgent(), { reason: 'policy' })], async () => 'rejected');
  const payload = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual([payload.hook_event_name, payload.tool_name, payload.tool_use_id, payload.reason], ['PermissionDenied', 'Bash', 'c1', 'policy']);
});

test('PermissionDenied does not run for an allowed approval', async () => {
  const file = join(tempDir('dcc-denied-'), 'ran');
  const h = harness({ PermissionDenied: [{ ...ASK, hooks: [{ command: `echo ran >> "${file}"` }] }] });
  for (const outcome of ['allowed-once', 'cancelled', 'unavailable']) {
    await h.dispatch('approval/request', [approval(fakeAgent())], async () => outcome);
  }
  assert.throws(() => readFileSync(file), /ENOENT/);
});

test('PermissionDenied does not run when a PermissionRequest hook made the denial', async () => {
  const file = join(tempDir('dcc-denied-'), 'ran');
  const h = harness({
    PermissionRequest: [{ ...ASK, hooks: [{ command: decide({ behavior: 'deny' }) }] }],
    PermissionDenied: [{ ...ASK, hooks: [{ command: `echo ran >> "${file}"` }] }],
  });
  await withWarnings(() => h.dispatch('approval/request', [approval(fakeAgent())], async () => 'allowed-once'));
  assert.throws(() => readFileSync(file), /ENOENT/);
});

test('PermissionDenied: retry true tells the model it may retry; additionalContext is injected', async () => {
  const agent = fakeAgent();
  const h = harness({
    PermissionDenied: [{ ...ASK, hooks: [{ command: say({ hookSpecificOutput: { retry: true, additionalContext: 'see policy' } }) }] }],
  });
  await h.dispatch('approval/request', [approval(agent)], async () => 'rejected');
  assert.equal(agent.injected.length, 2);
  assert.equal(textOf(agent.injected[0]), 'see policy');
  assert.match(textOf(agent.injected[1]), /Bash call was denied.*may retry/);
});

// ─── PostToolBatch ───────────────────────────────────────────────────────────

const enter = async () => ({ kind: 'enter', messages: [{ content: [{ type: 'text', text: 'user' }] }] });
const step = (agent) => ({ agent, messages: [] });

test('PostToolBatch runs once at the next step, with every result of the batch', async () => {
  const file = join(tempDir('dcc-batch-'), 'stdin.json');
  const h = harness({ PostToolBatch: [{ hooks: [{ command: `cat > "${file}"` }] }] });
  const agent = fakeAgent('s2');
  await h.dispatch('tools/post-execute', [exec(agent, { callId: 'a' }), ok({ n: 1 })], async () => ({ kind: 'accept' }));
  await h.dispatch('tools/post-execute', [exec(agent, { callId: 'b', name: 'Read' }), failed()], async () => ({ kind: 'accept' }));
  await h.dispatch('agent/pre-step', [step(agent)], enter);
  const payload = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(payload.hook_event_name, 'PostToolBatch');
  assert.equal(payload.session_id, 's2');
  assert.deepEqual(payload.tool_calls.map((call) => [call.tool_use_id, call.tool_name, call.tool_response]), [
    ['a', 'Bash', { n: 1 }],
    ['b', 'Read', 'it broke'],
  ]);
});

test('PostToolBatch does not run again for a step with no new results', async () => {
  const file = join(tempDir('dcc-batch-'), 'runs');
  const h = harness({ PostToolBatch: [{ hooks: [{ command: `echo run >> "${file}"` }] }] });
  const agent = fakeAgent();
  await h.dispatch('tools/post-execute', [exec(agent), ok('x')], async () => ({ kind: 'accept' }));
  await h.dispatch('agent/pre-step', [step(agent)], enter);
  await h.dispatch('agent/pre-step', [step(agent)], enter);
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 1);
});

test('PostToolBatch keeps the results of two sessions apart', async () => {
  const file = join(tempDir('dcc-batch-'), 'ids');
  const h = harness({ PostToolBatch: [{ hooks: [{ command: `cat | tr -d '\\n' >> "${file}"; echo >> "${file}"` }] }] });
  const one = fakeAgent('one');
  const two = fakeAgent('two');
  await h.dispatch('tools/post-execute', [exec(one, { callId: '1' }), ok('x')], async () => ({ kind: 'accept' }));
  await h.dispatch('tools/post-execute', [exec(two, { callId: '2' }), ok('y')], async () => ({ kind: 'accept' }));
  await h.dispatch('agent/pre-step', [step(one)], enter);
  const [line] = readFileSync(file, 'utf8').trim().split('\n');
  const payload = JSON.parse(line);
  assert.deepEqual(payload.tool_calls.map((call) => call.tool_use_id), ['1']);
});

test('PostToolBatch: exit 2, decision block and continue false reject the step', async () => {
  for (const command of ['echo stop >&2; exit 2', say({ decision: 'block', reason: 'x' }), say({ continue: false })]) {
    const h = harness({ PostToolBatch: [{ hooks: [{ command }] }] });
    const agent = fakeAgent();
    await h.dispatch('tools/post-execute', [exec(agent), ok('x')], async () => ({ kind: 'accept' }));
    const { value } = await withWarnings(() => h.dispatch('agent/pre-step', [step(agent)], enter));
    assert.deepEqual(value, { kind: 'reject' }, command);
  }
});

test('PostToolBatch: additionalContext follows the step messages', async () => {
  const h = harness({ PostToolBatch: [{ hooks: [{ command: say({ hookSpecificOutput: { additionalContext: 'lint passed' } }) }] }] });
  const agent = fakeAgent();
  await h.dispatch('tools/post-execute', [exec(agent), ok('x')], async () => ({ kind: 'accept' }));
  const decision = await h.dispatch('agent/pre-step', [step(agent)], enter);
  assert.equal(decision.messages.length, 2);
  assert.equal(textOf(decision.messages[1]), 'lint passed');
});

test('PostToolBatch: the results of a batch are still passed down the post-execute chain', async () => {
  const h = harness({ PostToolBatch: [{ hooks: [{ command: 'exit 0' }] }] });
  const downstream = await h.dispatch('tools/post-execute', [exec(fakeAgent()), ok('x')], async () => ({ kind: 'accept', marker: 1 }));
  assert.equal(downstream.marker, 1);
});

// ─── asyncRewake ─────────────────────────────────────────────────────────────

test('asyncRewake: exit 2 from a background hook steers the agent with the hook output', async () => {
  const agent = fakeAgent();
  const h = harness({ PreToolUse: [{ ...ASK, hooks: [{ command: 'echo tests failed >&2; exit 2', asyncRewake: true }] }] });
  const decision = await h.dispatch('tools/pre-execute', [exec(agent)], allowTool);
  assert.equal(decision.kind, 'allow', 'the call is not held for an async hook');
  await waitFor(() => agent.steered.length > 0);
  assert.match(textOf(agent.steered[0]), /<system-reminder>\ntests failed\n<\/system-reminder>/);
});

test('asyncRewake: exit 0 does not wake the agent', async () => {
  const agent = fakeAgent();
  const h = harness({ PreToolUse: [{ ...ASK, hooks: [{ command: 'exit 0', asyncRewake: true }] }] });
  await h.dispatch('tools/pre-execute', [exec(agent)], allowTool);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(agent.steered.length, 0);
});

test('a finished call is dropped from the input log, so a reused call id sends no stale input', async () => {
  const file = join(tempDir('dcc-perm-'), 'stdin.json');
  const h = harness({ PermissionRequest: [{ ...ASK, hooks: [{ command: `cat > "${file}"` }] }] });
  const agent = fakeAgent();
  await h.dispatch('tools/pre-execute', [exec(agent)], allowTool);
  await h.dispatch('tools/post-execute', [exec(agent), ok('x')], async () => ({ kind: 'accept' }));
  await h.dispatch('approval/request', [approval(agent)], async () => 'allowed-once');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).tool_input, {});
});
