// Hook bridges (src/hooks.js and src/hook-bridge-*.js): the DSH listeners with a
// fake context and fake agents. Hooks are real shell commands, so the whole path
// from settings.json to a DSH decision runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerHooks } from '../src/hooks.js';

const tempDir = (prefix) => mkdtempSync(join(tmpdir(), prefix));

// A hook command that prints a JSON object. The JSON must not contain a single quote.
const say = (value) => `printf '%s' '${JSON.stringify(value)}'`;

async function withWarnings(fn) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const value = await fn(warnings);
    return { value, warnings };
  } finally {
    console.warn = original;
  }
}

async function waitFor(predicate, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return predicate();
}

function fakeAgent(id = 'sess-1', cwd = '/work') {
  const agent = {
    session: { id, header: { id, cwd } },
    injected: [],
    steered: [],
    inject: (message) => agent.injected.push(message),
    steer: (message) => agent.steered.push(message),
  };
  return agent;
}

// Register the hooks from a settings object and return the listeners by event name.
function listenersFor(hooks, options = {}) {
  const dir = tempDir('dcc-bridge-');
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ hooks }));
  const listeners = new Map();
  const ctx = { on: (name, fn) => listeners.set(name, fn), effect: () => {}, ...options.ctx };
  const engine = registerHooks(
    ctx,
    { userClaudeDir: dir, projectRootMarkers: ['.git'], hooksTimeoutMs: 5000 },
    { runners: options.runners },
  );
  listeners.engine = engine;
  return listeners;
}

const allow = async () => ({ kind: 'allow' });
const accept = async () => ({ kind: 'accept' });
const preCall = (name, input, agent) => ({ name, arguments: input, callId: 'call-1', agent });
const textOf = (message) => message.content[0].text;

// ─── PreToolUse ──────────────────────────────────────────────────────────────

test('PreToolUse: no hook objection delegates to next(), so later listeners still run', async () => {
  const listeners = listenersFor({ PreToolUse: [{ matcher: '.*', hooks: [{ command: 'exit 0' }] }] });
  const decision = await listeners.get('tools/pre-execute')(preCall('Read', {}), async () => ({ kind: 'cancel' }));
  assert.equal(decision.kind, 'cancel', 'the downstream decision is returned');
});

test('PreToolUse: exit 2 denies with the hook output as the reason', async () => {
  const listeners = listenersFor({ PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'echo nope >&2; exit 2' }] }] });
  const decision = await listeners.get('tools/pre-execute')(preCall('Bash', { command: 'rm -rf /' }), allow);
  assert.deepEqual(decision, { kind: 'deny', reason: 'nope' });
});

test('PreToolUse: exit 2 with no output denies with a default reason', async () => {
  const listeners = listenersFor({ PreToolUse: [{ matcher: '.*', hooks: [{ command: 'exit 2' }] }] });
  const decision = await listeners.get('tools/pre-execute')(preCall('Read', {}), allow);
  assert.deepEqual(decision, { kind: 'deny', reason: 'blocked by PreToolUse hook' });
});

test('PreToolUse: permissionDecision deny and ask map to DSH decisions', async () => {
  const decide = (permissionDecision) => ({
    PreToolUse: [{ matcher: '.*', hooks: [{ command: say({ hookSpecificOutput: { permissionDecision, permissionDecisionReason: 'why' } }) }] }],
  });
  const deny = await listenersFor(decide('deny')).get('tools/pre-execute')(preCall('Read', {}), allow);
  assert.deepEqual(deny, { kind: 'deny', reason: 'why' });
  const ask = await listenersFor(decide('ask')).get('tools/pre-execute')(preCall('Read', {}), allow);
  assert.deepEqual(ask, { kind: 'ask', reason: 'why' });
  const permit = await listenersFor(decide('allow')).get('tools/pre-execute')(preCall('Read', {}), allow);
  assert.equal(permit.kind, 'allow');
});

test('PreToolUse: continue:false stops the call with the stop reason', async () => {
  const listeners = listenersFor({
    PreToolUse: [{ matcher: '.*', hooks: [{ command: say({ continue: false, stopReason: 'halt' }) }] }],
  });
  const decision = await listeners.get('tools/pre-execute')(preCall('Read', {}), allow);
  assert.deepEqual(decision, { kind: 'deny', reason: 'halt' });
});

test('PreToolUse: an if rule runs the hook only for matching calls', async () => {
  const listeners = listenersFor({
    PreToolUse: [{ matcher: 'Bash', hooks: [{ if: 'Bash(git *)', command: 'exit 2' }] }],
  });
  const pre = listeners.get('tools/pre-execute');
  assert.equal((await pre(preCall('Bash', { command: 'git status' }), allow)).kind, 'deny');
  assert.equal((await pre(preCall('Bash', { command: 'npm test' }), allow)).kind, 'allow');
});

test('PreToolUse: updatedInput is warned, because DSH tool input cannot change', async () => {
  const listeners = listenersFor({
    PreToolUse: [{ matcher: '.*', hooks: [{ command: say({ hookSpecificOutput: { updatedInput: { a: 1 } } }) }] }],
  });
  const { value, warnings } = await withWarnings(() => listeners.get('tools/pre-execute')(preCall('Read', {}), allow));
  assert.equal(value.kind, 'allow');
  assert.match(warnings[0], /DSH tool input cannot be changed/);
});

test('PreToolUse: additionalContext is injected into the calling agent', async () => {
  const agent = fakeAgent();
  const listeners = listenersFor({
    PreToolUse: [{ matcher: '.*', hooks: [{ command: say({ hookSpecificOutput: { additionalContext: 'careful' } }) }] }],
  });
  await listeners.get('tools/pre-execute')(preCall('Read', {}, agent), allow);
  assert.equal(agent.injected.length, 1);
  assert.equal(textOf(agent.injected[0]), 'careful');
});

test('PreToolUse: stdin carries the real session id, the tool call id and the cwd', async () => {
  const file = join(tempDir('dcc-stdin-'), 'stdin.json');
  const listeners = listenersFor({ PreToolUse: [{ matcher: 'Bash', hooks: [{ command: `cat > "${file}"` }] }] });
  await listeners.get('tools/pre-execute')(preCall('Bash', { command: 'git status' }, fakeAgent('sess-42', '/proj')), allow);
  const payload = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(payload.hook_event_name, 'PreToolUse');
  assert.equal(payload.session_id, 'sess-42', 'the session id, not the call id');
  assert.equal(payload.tool_use_id, 'call-1');
  assert.equal(payload.tool_name, 'Bash');
  assert.deepEqual(payload.tool_input, { command: 'git status' });
  assert.equal(payload.cwd, '/proj');
});

test('a tool call with no agent still runs hooks, with an empty session id', async () => {
  const file = join(tempDir('dcc-stdin-'), 'stdin.json');
  const listeners = listenersFor({ PreToolUse: [{ matcher: '.*', hooks: [{ command: `cat > "${file}"` }] }] });
  await listeners.get('tools/pre-execute')(preCall('Read', {}), allow);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).session_id, '');
});

test('onFailure block turns a failed pre-tool hook into a deny with the reason', async () => {
  const listeners = listenersFor({ PreToolUse: [{ matcher: '.*', hooks: [{ command: 'exit 5', onFailure: 'block' }] }] });
  const { value, warnings } = await withWarnings(() => listeners.get('tools/pre-execute')(preCall('Read', {}), allow));
  assert.equal(value.kind, 'deny');
  assert.match(value.reason, /hook failed \(exit 5\)/);
  assert.match(warnings[0], /PreToolUse hook failed, exit 5/);
});

test('without onFailure a failed pre-tool hook allows the call and logs the reason once', async () => {
  const listeners = listenersFor({ PreToolUse: [{ matcher: '.*', hooks: [{ command: 'exit 5' }] }] });
  const { value, warnings } = await withWarnings(() => listeners.get('tools/pre-execute')(preCall('Read', {}), allow));
  assert.equal(value.kind, 'allow');
  assert.equal(warnings.length, 1);
});

test('an async tool hook cannot change the decision, and its failure is logged', async () => {
  const listeners = listenersFor({ PreToolUse: [{ matcher: '.*', hooks: [{ command: 'exit 5', async: true }] }] });
  const { value, warnings } = await withWarnings(async (logged) => {
    const decision = await listeners.get('tools/pre-execute')(preCall('Read', {}), allow);
    await waitFor(() => logged.length > 0);
    return decision;
  });
  assert.equal(value.kind, 'allow');
  assert.match(warnings[0], /async PreToolUse hook failed, exit 5/);
});

test('an async hook that exits 2 cannot block, and says so', async () => {
  const listeners = listenersFor({ PreToolUse: [{ matcher: '.*', hooks: [{ command: 'exit 2', async: true }] }] });
  const { value, warnings } = await withWarnings(async (logged) => {
    const decision = await listeners.get('tools/pre-execute')(preCall('Read', {}), allow);
    await waitFor(() => logged.length > 0);
    return decision;
  });
  assert.equal(value.kind, 'allow');
  assert.match(warnings[0], /exit 2 cannot block/);
});

test('an http hook runs through the http runner and its JSON decision applies', async () => {
  const runners = { http: async () => ({ exitCode: 0, stdout: JSON.stringify({ decision: 'block', reason: 'policy' }), failed: false }) };
  const listeners = listenersFor(
    { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'http', url: 'https://example.test/h' }] }] },
    { runners },
  );
  const decision = await listeners.get('tools/pre-execute')(preCall('Read', {}), allow);
  assert.deepEqual(decision, { kind: 'deny', reason: 'policy' });
});

// ─── PostToolUse and PostToolUseFailure ──────────────────────────────────────

const success = (value = { ok: true }) => ({ isError: false, value, content: [{ type: 'text', text: 'done' }] });
const failure = (code = 'FAILED') => ({ isError: true, error: { code }, content: [{ type: 'text', text: 'it broke' }] });

test('PostToolUse runs for a success and not for a failure', async () => {
  const file = join(tempDir('dcc-post-'), 'ran');
  const listeners = listenersFor({ PostToolUse: [{ matcher: '.*', hooks: [{ command: `echo ran >> "${file}"` }] }] });
  const post = listeners.get('tools/post-execute');
  await post(preCall('Read', {}), failure(), accept);
  assert.throws(() => readFileSync(file), /ENOENT/, 'no run for a failed tool');
  await post(preCall('Read', {}), success(), accept);
  assert.match(readFileSync(file, 'utf8'), /ran/);
});

test('PostToolUse: stdin carries tool_response, the value when the tool has one', async () => {
  const file = join(tempDir('dcc-post-'), 'stdin.json');
  const listeners = listenersFor({ PostToolUse: [{ matcher: '.*', hooks: [{ command: `cat > "${file}"` }] }] });
  await listeners.get('tools/post-execute')(preCall('Read', { a: 1 }, fakeAgent('s9')), success({ n: 2 }), accept);
  const payload = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(payload.hook_event_name, 'PostToolUse');
  assert.deepEqual(payload.tool_response, { n: 2 });
  assert.equal(payload.session_id, 's9');
});

test('PostToolUseFailure runs for a failure with the error text and the interrupt flag', async () => {
  const file = join(tempDir('dcc-fail-'), 'stdin.json');
  const listeners = listenersFor({ PostToolUseFailure: [{ matcher: '.*', hooks: [{ command: `cat > "${file}"` }] }] });
  const post = listeners.get('tools/post-execute');
  await post(preCall('Bash', { command: 'x' }), failure('FAILED'), accept);
  let payload = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(payload.hook_event_name, 'PostToolUseFailure');
  assert.equal(payload.error, 'it broke');
  assert.equal(payload.is_interrupt, false);
  await post(preCall('Bash', { command: 'x' }), failure('ABORTED'), accept);
  payload = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(payload.is_interrupt, true);
});

test('PostToolUseFailure does not run for a success', async () => {
  const file = join(tempDir('dcc-fail-'), 'ran');
  const listeners = listenersFor({ PostToolUseFailure: [{ matcher: '.*', hooks: [{ command: `echo ran >> "${file}"` }] }] });
  await listeners.get('tools/post-execute')(preCall('Read', {}), success(), accept);
  assert.throws(() => readFileSync(file), /ENOENT/);
});

test('PostToolUse: exit 2 or decision block turns the result into feedback for the model', async () => {
  const exit2 = listenersFor({ PostToolUse: [{ matcher: '.*', hooks: [{ command: 'echo redo >&2; exit 2' }] }] });
  const blocked = await exit2.get('tools/post-execute')(preCall('Read', {}), success(), accept);
  assert.deepEqual(blocked, { kind: 'block', feedback: [{ type: 'text', text: 'redo' }] });
  const decision = listenersFor({ PostToolUse: [{ matcher: '.*', hooks: [{ command: say({ decision: 'block', reason: 'bad output' }) }] }] });
  const viaJson = await decision.get('tools/post-execute')(preCall('Read', {}), success(), accept);
  assert.equal(viaJson.feedback[0].text, 'bad output');
});

test('PostToolUse: contexts from several hooks all reach the decision, ahead of downstream ones', async () => {
  const listeners = listenersFor({
    PostToolUse: [{ matcher: '.*', hooks: [
      { command: say({ hookSpecificOutput: { additionalContext: 'A' } }) },
      { command: say({ hookSpecificOutput: { additionalContext: 'B' } }) },
    ] }],
  });
  const downstream = async () => ({ kind: 'accept', additionalContexts: ['downstream'] });
  const decision = await listeners.get('tools/post-execute')(preCall('Read', {}), success(), downstream);
  assert.equal(decision.kind, 'accept');
  assert.equal(decision.additionalContexts.length, 3);
  assert.equal(decision.additionalContexts[2], 'downstream');
});

test('PostToolUse: updatedToolOutput replaces the result; text becomes content, other values the value', async () => {
  const text = listenersFor({
    PostToolUse: [{ matcher: '.*', hooks: [{ command: say({ hookSpecificOutput: { updatedToolOutput: 'redacted' } }) }] }],
  });
  const replaced = await text.get('tools/post-execute')(preCall('Read', {}), success(), accept);
  assert.deepEqual(replaced, { kind: 'accept', content: [{ type: 'text', text: 'redacted' }] });
  const object = listenersFor({
    PostToolUse: [{ matcher: '.*', hooks: [{ command: say({ hookSpecificOutput: { updatedToolOutput: { n: 1 } } }) }] }],
  });
  assert.deepEqual(await object.get('tools/post-execute')(preCall('Read', {}), success(), accept), { kind: 'accept', value: { n: 1 } });
});

test('PostToolUseFailure: additionalContext is added to the downstream decision', async () => {
  const listeners = listenersFor({
    PostToolUseFailure: [{ matcher: '.*', hooks: [{ command: say({ hookSpecificOutput: { additionalContext: 'try again' } }) }] }],
  });
  const decision = await listeners.get('tools/post-execute')(preCall('Read', {}), failure(), accept);
  assert.equal(decision.additionalContexts.length, 1);
});

test('onFailure block turns a failed post-tool hook into a block', async () => {
  const listeners = listenersFor({ PostToolUse: [{ matcher: '.*', hooks: [{ command: 'exit 5', onFailure: 'block' }] }] });
  const { value } = await withWarnings(() => listeners.get('tools/post-execute')(preCall('Read', {}), success(), accept));
  assert.equal(value.kind, 'block');
  assert.match(value.feedback[0].text, /hook failed \(exit 5\)/);
});

// ─── SessionStart and SessionEnd ─────────────────────────────────────────────

test('SessionStart runs on agent/created, filtered by the start source', async () => {
  const listeners = listenersFor({
    SessionStart: [
      { matcher: 'startup', hooks: [{ command: 'printf from-startup' }] },
      { matcher: 'resume', hooks: [{ command: 'printf from-resume' }] },
    ],
  });
  const agent = fakeAgent();
  await listeners.get('agent/created')({ agent, source: 'startup' });
  assert.equal(agent.injected.length, 1);
  assert.equal(textOf(agent.injected[0]), 'from-startup', 'plain stdout is context on SessionStart');
  const resumed = fakeAgent();
  await listeners.get('agent/created')({ agent: resumed, source: 'resume' });
  assert.equal(textOf(resumed.injected[0]), 'from-resume');
});

test('SessionStart does not listen to the agent/session-start event, which DSH does not have', () => {
  const listeners = listenersFor({ SessionStart: [{ matcher: '.*', hooks: [{ command: 'exit 0' }] }] });
  assert.equal(listeners.has('agent/session-start'), false);
  assert.equal(listeners.has('agent/created'), true);
});

test('SessionStart: stdin carries the source and the session id', async () => {
  const file = join(tempDir('dcc-start-'), 'stdin.json');
  const listeners = listenersFor({ SessionStart: [{ matcher: '.*', hooks: [{ command: `cat > "${file}"` }] }] });
  await listeners.get('agent/created')({ agent: fakeAgent('s7', '/p'), source: 'compact' });
  const payload = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual([payload.hook_event_name, payload.source, payload.session_id, payload.cwd], ['SessionStart', 'compact', 's7', '/p']);
});

test('SessionEnd runs on agent/disposed and the run is tracked until it ends', async () => {
  const file = join(tempDir('dcc-end-'), 'stdin.json');
  const drained = [];
  const listeners = listenersFor(
    { SessionEnd: [{ matcher: '.*', hooks: [{ command: `cat > "${file}"` }] }] },
    { ctx: { effect: (setup) => drained.push(setup()) } },
  );
  listeners.get('agent/disposed')({ agent: fakeAgent('s3') });
  await drained[0]();
  const payload = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual([payload.hook_event_name, payload.reason, payload.session_id], ['SessionEnd', 'other', 's3']);
});

// ─── UserPromptSubmit ────────────────────────────────────────────────────────

const stepWith = (text, agent = fakeAgent()) => ({
  agent,
  messages: [{ content: [{ type: 'text', text }] }],
});
const enter = async () => ({ kind: 'enter', messages: [{ content: [{ type: 'text', text: 'user' }] }] });

test('UserPromptSubmit: a step with no user messages does not run the hook', async () => {
  const file = join(tempDir('dcc-prompt-'), 'ran');
  const listeners = listenersFor({ UserPromptSubmit: [{ matcher: '.*', hooks: [{ command: `echo ran >> "${file}"` }] }] });
  const decision = await listeners.get('agent/pre-step')({ agent: fakeAgent(), messages: [] }, enter);
  assert.equal(decision.kind, 'enter');
  assert.throws(() => readFileSync(file), /ENOENT/);
});

test('UserPromptSubmit: exit 2 rejects the prompt', async () => {
  const listeners = listenersFor({ UserPromptSubmit: [{ matcher: '.*', hooks: [{ command: 'echo no >&2; exit 2' }] }] });
  const { value, warnings } = await withWarnings(() => listeners.get('agent/pre-step')(stepWith('hello'), enter));
  assert.deepEqual(value, { kind: 'reject' });
  assert.match(warnings[0], /blocked the prompt: no/);
});

test('UserPromptSubmit: decision block rejects the prompt', async () => {
  const listeners = listenersFor({ UserPromptSubmit: [{ matcher: '.*', hooks: [{ command: say({ decision: 'block', reason: 'nope' }) }] }] });
  const { value } = await withWarnings(() => listeners.get('agent/pre-step')(stepWith('hello'), enter));
  assert.deepEqual(value, { kind: 'reject' });
});

test('UserPromptSubmit: stdout becomes context after the user messages, and stdin has the prompt', async () => {
  const file = join(tempDir('dcc-prompt-'), 'stdin.json');
  const listeners = listenersFor({ UserPromptSubmit: [{ matcher: '.*', hooks: [{ command: `tee "${file}" >/dev/null; printf extra` }] }] });
  const decision = await listeners.get('agent/pre-step')(stepWith('fix the bug', fakeAgent('s5')), enter);
  assert.equal(decision.kind, 'enter');
  assert.equal(decision.messages.length, 2);
  assert.equal(textOf(decision.messages[1]), 'extra');
  const payload = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual([payload.hook_event_name, payload.prompt, payload.session_id], ['UserPromptSubmit', 'fix the bug', 's5']);
});

test('UserPromptSubmit: a downstream reject stays a reject', async () => {
  const listeners = listenersFor({ UserPromptSubmit: [{ matcher: '.*', hooks: [{ command: 'printf extra' }] }] });
  const decision = await listeners.get('agent/pre-step')(stepWith('x'), async () => ({ kind: 'reject' }));
  assert.deepEqual(decision, { kind: 'reject' });
});

// ─── settings loading ────────────────────────────────────────────────────────

test('an unknown hook event is warned, not silently dropped', async () => {
  const { warnings } = await withWarnings(async () => listenersFor({
    NotAClaudeEvent: [{ matcher: '.*', hooks: [{ command: 'exit 0' }] }],
  }));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /"NotAClaudeEvent" is not a Claude Code event/);
});

test('an event DSH has no extension point for is warned with the reason', async () => {
  const { warnings } = await withWarnings(async () => listenersFor({
    Elicitation: [{ matcher: '.*', hooks: [{ command: 'exit 0' }] }],
    DirectoryAdded: [{ hooks: [{ command: 'exit 0' }] }],
  }));
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /"Elicitation" cannot run in DSH: the DSH MCP client does not support elicitation/);
  assert.match(warnings[1], /"DirectoryAdded" cannot run in DSH: .*--add-dir/);
});

test('an unknown handler type is skipped with a warning that names the file', async () => {
  const { value, warnings } = await withWarnings(async () => listenersFor({
    PreToolUse: [{ matcher: '.*', hooks: [{ type: 'websocket', url: 'ws://x' }] }],
  }));
  assert.equal(value.has('tools/pre-execute'), false, 'no skipped hook registers a listener');
  assert.match(warnings[0], /hook skipped: handler type "websocket" is not supported \(.*settings\.json\)/);
});

test('a non-string matcher skips its entry, so it cannot widen to every tool', async () => {
  const { value, warnings } = await withWarnings(async () => listenersFor({
    PreToolUse: [{ matcher: 5, hooks: [{ command: 'exit 2' }] }],
  }));
  assert.equal(value.has('tools/pre-execute'), false);
  assert.match(warnings[0], /matcher must be a string/);
});
