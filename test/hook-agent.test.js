// Stop, StopFailure, SubagentStart/Stop, MessageDisplay and Notification bridges.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyError, stopCap } from '../src/hook-bridge-agent.js';
import { fakeAgent, harness, say, tempDir, textOf, waitFor, withWarnings } from './hook-kit.js';

const ALL = { matcher: '.*' };
const allow = async () => ({ kind: 'allow' });
const stopping = (agent) => ({ agent, turn: 1, signal: new AbortController().signal });
const logTo = (file) => `cat | tr -d '\\n' >> "${file}"; echo >> "${file}"`;
const readLines = (file) => readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));

// Stream frames, as DSH emits them for one assistant message.
const start = (turn = 1) => ({ type: 'start', turn, step: 0 });
const chunk = (text) => ({ type: 'chunk', chunk: { type: 'text-delta', text } });
const end = (kind = 'committed') => ({ type: 'end', outcome: { kind } });
const stream = (h, agent, ...frames) => frames.forEach((frame) => h.dispatch('agent/assistant-stream', [{ agent, frame }], () => {}));

async function withEnv(name, value, fn) {
  const before = process.env[name];
  process.env[name] = value;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  }
}

// ─── Stop ────────────────────────────────────────────────────────────────────

test('Stop with no objection lets the turn end, and sends the last assistant message', async () => {
  const file = join(tempDir('dcc-stop-'), 'stdin.json');
  const h = harness({ Stop: [{ hooks: [{ command: `cat > "${file}"` }] }] });
  const agent = fakeAgent('s6');
  stream(h, agent, start(), chunk('All '), chunk('done.'), end());
  await h.dispatch('agent/turn-stopping', [stopping(agent)], () => {});
  const payload = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(
    [payload.hook_event_name, payload.stop_hook_active, payload.last_assistant_message, payload.session_id],
    ['Stop', false, 'All done.', 's6'],
  );
  assert.deepEqual([payload.background_tasks, payload.session_crons], [[], []]);
  assert.equal(agent.steered.length, 0);
});

test('Stop: the last message is the latest one, not the first of the turn', async () => {
  const file = join(tempDir('dcc-stop-'), 'stdin.json');
  const h = harness({ Stop: [{ hooks: [{ command: `cat > "${file}"` }] }] });
  const agent = fakeAgent();
  stream(h, agent, start(), chunk('first'), end(), start(), chunk('second'), end());
  await h.dispatch('agent/turn-stopping', [stopping(agent)], () => {});
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).last_assistant_message, 'second');
});

test('Stop: exit 2 steers the agent with the reason, and the next Stop reports stop_hook_active', async () => {
  const file = join(tempDir('dcc-stop-'), 'lines');
  const h = harness({ Stop: [{ hooks: [{ command: `${logTo(file)}; echo run the tests >&2; exit 2` }] }] });
  const agent = fakeAgent();
  await h.dispatch('agent/turn-stopping', [stopping(agent)], () => {});
  await h.dispatch('agent/turn-stopping', [stopping(agent)], () => {});
  assert.equal(agent.steered.length, 2);
  assert.equal(textOf(agent.steered[0]), 'run the tests');
  const payloads = readLines(file);
  assert.deepEqual(payloads.map((payload) => payload.stop_hook_active), [false, true]);
});

test('Stop: a block decision steers with its reason', async () => {
  const h = harness({ Stop: [{ hooks: [{ command: say({ decision: 'block', reason: 'not finished' }) }] }] });
  const agent = fakeAgent();
  await h.dispatch('agent/turn-stopping', [stopping(agent)], () => {});
  assert.equal(textOf(agent.steered[0]), 'not finished');
});

test('Stop: additionalContext continues the turn as feedback', async () => {
  const h = harness({ Stop: [{ hooks: [{ command: say({ hookSpecificOutput: { additionalContext: 'run the suite first' } }) }] }] });
  const agent = fakeAgent();
  await h.dispatch('agent/turn-stopping', [stopping(agent)], () => {});
  assert.equal(textOf(agent.steered[0]), 'run the suite first');
});

test('Stop: continue false ends the turn even when the hook also blocks', async () => {
  const h = harness({ Stop: [{ hooks: [{ command: say({ continue: false, decision: 'block', reason: 'x' }) }] }] });
  const agent = fakeAgent();
  await h.dispatch('agent/turn-stopping', [stopping(agent)], () => {});
  assert.equal(agent.steered.length, 0);
});

test('Stop: a block with no reason still continues, with a default reason', async () => {
  const h = harness({ Stop: [{ hooks: [{ command: 'exit 2' }] }] });
  const agent = fakeAgent();
  await h.dispatch('agent/turn-stopping', [stopping(agent)], () => {});
  assert.equal(textOf(agent.steered[0]), 'blocked by Stop hook');
});

test('Stop: a hook that fails does not continue the turn, even with onFailure block', async () => {
  const h = harness({ Stop: [{ hooks: [{ command: 'exit 5', onFailure: 'block' }] }] });
  const agent = fakeAgent();
  await withWarnings(() => h.dispatch('agent/turn-stopping', [stopping(agent)], () => {}));
  assert.equal(agent.steered.length, 0);
});

test('Stop: the cap ends the turn after that many continuations in a row', async () => {
  await withEnv('CLAUDE_CODE_STOP_HOOK_BLOCK_CAP', '2', async () => {
    const h = harness({ Stop: [{ hooks: [{ command: 'exit 2' }] }] });
    const agent = fakeAgent();
    const { warnings } = await withWarnings(async () => {
      for (let i = 0; i < 4; i += 1) await h.dispatch('agent/turn-stopping', [stopping(agent)], () => {});
    });
    assert.equal(agent.steered.length, 3, 'two continuations, then the capped stop ends, then a new chain continues');
    assert.match(warnings[0], /continued the turn 2 times in a row/);
  });
});

test('Stop: a tool call starts the count again', async () => {
  await withEnv('CLAUDE_CODE_STOP_HOOK_BLOCK_CAP', '1', async () => {
    const h = harness({ Stop: [{ hooks: [{ command: 'exit 2' }] }] });
    const agent = fakeAgent();
    await h.dispatch('agent/turn-stopping', [stopping(agent)], () => {});
    await h.dispatch('tools/pre-execute', [{ name: 'Bash', arguments: {}, callId: 'c', agent }], allow);
    await h.dispatch('agent/turn-stopping', [stopping(agent)], () => {});
    assert.equal(agent.steered.length, 2, 'without the reset the second stop is capped');
  });
});

test('Stop: a stop with no objection starts the count again', async () => {
  await withEnv('CLAUDE_CODE_STOP_HOOK_BLOCK_CAP', '1', async () => {
    const flag = join(tempDir('dcc-stop-'), 'flag');
    const command = `if [ -e "${flag}" ]; then rm "${flag}"; exit 0; else touch "${flag}"; exit 2; fi`;
    const h = harness({ Stop: [{ hooks: [{ command }] }] });
    const agent = fakeAgent();
    for (let i = 0; i < 3; i += 1) await h.dispatch('agent/turn-stopping', [stopping(agent)], () => {});
    assert.equal(agent.steered.length, 2, 'block, pass, block');
  });
});

test('stopCap reads the environment variable and ignores a value that is not a positive integer', () => {
  assert.equal(stopCap({ CLAUDE_CODE_STOP_HOOK_BLOCK_CAP: '3' }), 3);
  for (const bad of [undefined, '', '0', '-2', '1.5', 'x']) {
    assert.equal(stopCap({ CLAUDE_CODE_STOP_HOOK_BLOCK_CAP: bad }), 8, String(bad));
  }
});

// ─── StopFailure ─────────────────────────────────────────────────────────────

const llmError = (code, extra = {}) => Object.assign(new Error('provider said no'), { name: 'LlmError', code, ...extra });

test('classifyError maps the DSH failure codes to Claude Code error types', () => {
  const cases = {
    AUTH: 'authentication_failed', QUOTA: 'billing_error', RATE_LIMIT: 'rate_limit', INVALID_REQUEST: 'invalid_request',
    CONTEXT_WINDOW_EXCEEDED: 'invalid_request', SERVER: 'server_error', HTTP_404: 'model_not_found', TIMEOUT: 'unknown',
  };
  for (const [code, type] of Object.entries(cases)) assert.equal(classifyError(llmError(code)), type, code);
  assert.equal(classifyError(llmError('SERVER', { failure: { status: 529 } })), 'overloaded');
  assert.equal(classifyError(undefined), 'unknown');
});

test('StopFailure runs for a model-request error, with the type, the details and the type as matcher subject', async () => {
  const file = join(tempDir('dcc-fail-'), 'lines');
  const h = harness({
    StopFailure: [
      { matcher: 'rate_limit', hooks: [{ command: logTo(file) }] },
      { matcher: 'billing_error', hooks: [{ command: 'exit 9' }] },
    ],
  });
  const agent = fakeAgent('s1');
  h.dispatch('agent/error', [{ agent, turn: 1, step: 0, error: llmError('RATE_LIMIT') }], () => {});
  await h.drain();
  const [payload, ...rest] = readLines(file);
  assert.equal(rest.length, 0, 'only the rate_limit hook ran');
  assert.deepEqual([payload.hook_event_name, payload.error, payload.error_details, payload.session_id],
    ['StopFailure', 'rate_limit', 'provider said no', 's1']);
});

test('StopFailure does not run for an error that is not a model-request error', async () => {
  const file = join(tempDir('dcc-fail-'), 'ran');
  const h = harness({ StopFailure: [{ hooks: [{ command: `echo ran >> "${file}"` }] }] });
  h.dispatch('agent/error', [{ agent: fakeAgent(), turn: 1, step: 0, error: new Error('tool bug') }], () => {});
  await h.drain();
  assert.throws(() => readFileSync(file), /ENOENT/);
});

// ─── subagents ───────────────────────────────────────────────────────────────

const subagentCtx = (child) => ({ get: (name) => (name === 'agents' ? { get: (id) => (id === 'sub-1' ? child : undefined) } : undefined) });
const info = { runId: 'r1', provider: 'p', id: 'sub-1', local: true };

test('SubagentStart runs with the agent id and type, and injects its context into the child', async () => {
  const file = join(tempDir('dcc-sub-'), 'stdin.json');
  const child = fakeAgent('sub-1');
  const h = harness(
    { SubagentStart: [{ matcher: 'general-purpose', hooks: [{ command: `tee "${file}" >/dev/null; printf '%s' '${JSON.stringify({ hookSpecificOutput: { additionalContext: 'be brief' } })}'` }] }] },
    { ctx: subagentCtx(child) },
  );
  h.dispatch('subagent/start', [info], () => {});
  await h.drain();
  const payload = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual([payload.hook_event_name, payload.agent_id, payload.agent_type, payload.session_id], ['SubagentStart', 'sub-1', 'general-purpose', 'sub-1']);
  assert.equal(textOf(child.injected[0]), 'be brief');
});

test('SubagentStart still runs when the child agent cannot be found', async () => {
  const file = join(tempDir('dcc-sub-'), 'ran');
  const h = harness({ SubagentStart: [{ hooks: [{ command: `echo ran >> "${file}"` }] }] });
  h.dispatch('subagent/start', [info], () => {});
  await h.drain();
  assert.equal(readFileSync(file, 'utf8').trim(), 'ran');
});

test('SubagentStop sends the last assistant text, and warns when it asks to keep the subagent running', async () => {
  const file = join(tempDir('dcc-sub-'), 'stdin.json');
  const h = harness({ SubagentStop: [{ hooks: [{ command: `tee "${file}" >/dev/null; exit 2` }] }] });
  const { warnings } = await withWarnings(async () => {
    h.dispatch('subagent/end', [{ ...info, stopReason: 'end_turn', lastAssistantMessage: [{ type: 'text', text: 'found it' }] }], () => {});
    await h.drain();
  });
  const payload = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual([payload.hook_event_name, payload.last_assistant_message, payload.agent_id], ['SubagentStop', 'found it', 'sub-1']);
  assert.match(warnings[0], /already ended/);
});

test('SubagentStop with no last message sends an empty string', async () => {
  const file = join(tempDir('dcc-sub-'), 'stdin.json');
  const h = harness({ SubagentStop: [{ hooks: [{ command: `cat > "${file}"` }] }] });
  h.dispatch('subagent/end', [{ ...info, stopReason: 'end_turn' }], () => {});
  await h.drain();
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).last_assistant_message, '');
});

// ─── MessageDisplay ──────────────────────────────────────────────────────────

test('MessageDisplay runs per batch of whole lines, in order, with a final batch for the rest', async () => {
  const file = join(tempDir('dcc-display-'), 'lines');
  const h = harness({ MessageDisplay: [{ hooks: [{ command: logTo(file) }] }] });
  const agent = fakeAgent('s5');
  stream(h, agent, start(), chunk('Hello\nwor'), chunk('ld\n'), chunk('tail'), end());
  await h.drain();
  const batches = readLines(file);
  assert.deepEqual(batches.map((batch) => [batch.index, batch.final, batch.delta]), [
    [0, false, 'Hello\n'], [1, false, 'world\n'], [2, true, 'tail'],
  ]);
  assert.equal(new Set(batches.map((batch) => batch.message_id)).size, 1);
  assert.equal(batches[0].hook_event_name, 'MessageDisplay');
  assert.equal(batches[0].session_id, 's5');
});

test('MessageDisplay: the final batch is empty when the message ends on a newline', async () => {
  const file = join(tempDir('dcc-display-'), 'lines');
  const h = harness({ MessageDisplay: [{ hooks: [{ command: logTo(file) }] }] });
  stream(h, fakeAgent(), start(), chunk('one\n'), end());
  await h.drain();
  assert.deepEqual(readLines(file).map((batch) => [batch.final, batch.delta]), [[false, 'one\n'], [true, '']]);
});

test('MessageDisplay: a message gets its own id, and a turn keeps its turn id', async () => {
  const file = join(tempDir('dcc-display-'), 'lines');
  const h = harness({ MessageDisplay: [{ hooks: [{ command: logTo(file) }] }] });
  const agent = fakeAgent();
  stream(h, agent, start(1), chunk('a'), end(), start(1), chunk('b'), end(), start(2), chunk('c'), end());
  await h.drain();
  const [first, second, third] = readLines(file);
  assert.notEqual(first.message_id, second.message_id);
  assert.equal(first.turn_id, second.turn_id);
  assert.notEqual(second.turn_id, third.turn_id);
  assert.equal(first.index, 0);
  assert.equal(second.index, 0, 'the index restarts for each message');
});

test('MessageDisplay does not run for a message with no text, or for an abandoned attempt', async () => {
  const file = join(tempDir('dcc-display-'), 'ran');
  const h = harness({ MessageDisplay: [{ hooks: [{ command: `echo ran >> "${file}"` }] }] });
  const agent = fakeAgent();
  stream(h, agent, start(), end());
  stream(h, agent, start(), { type: 'chunk', chunk: { type: 'tool-call' } }, end());
  stream(h, agent, start(), chunk('partial text'), end('abandoned'));
  await h.drain();
  assert.throws(() => readFileSync(file), /ENOENT/);
});

test('MessageDisplay: displayContent is warned once, because DSH cannot change displayed text', async () => {
  const h = harness({ MessageDisplay: [{ hooks: [{ command: say({ hookSpecificOutput: { displayContent: 'x' } }) }] }] });
  const agent = fakeAgent();
  const { warnings } = await withWarnings(async () => {
    stream(h, agent, start(), chunk('a\n'), chunk('b\n'), end());
    await h.drain();
  });
  assert.equal(warnings.filter((line) => /displayContent/.test(line)).length, 1);
});

// ─── Notification ────────────────────────────────────────────────────────────

test('Notification permission_prompt runs for an approval request and passes the answer through', async () => {
  const file = join(tempDir('dcc-note-'), 'lines');
  const h = harness({ Notification: [{ matcher: 'permission_prompt', hooks: [{ command: logTo(file) }] }] });
  const answer = await h.dispatch('approval/request', [{ agent: fakeAgent('s3'), toolName: 'Bash' }], async () => 'allowed-once');
  await h.drain();
  assert.equal(answer, 'allowed-once');
  const [payload] = readLines(file);
  assert.deepEqual([payload.hook_event_name, payload.notification_type, payload.session_id], ['Notification', 'permission_prompt', 's3']);
  assert.match(payload.message, /Permission needed to use Bash/);
});

test('Notification agent_needs_input runs for a user question, with or without an agent', async () => {
  const file = join(tempDir('dcc-note-'), 'lines');
  const h = harness({ Notification: [{ matcher: 'agent_needs_input', hooks: [{ command: logTo(file) }] }] });
  const answer = await h.dispatch('user-questions/request', [{ questions: [] }], async () => 'answered');
  await h.drain();
  assert.equal(answer, 'answered');
  assert.equal(readLines(file)[0].notification_type, 'agent_needs_input');
});

test('Notification idle_prompt runs when a running agent becomes idle, and not for the first idle', async () => {
  const file = join(tempDir('dcc-note-'), 'lines');
  const h = harness({ Notification: [{ matcher: 'idle_prompt', hooks: [{ command: logTo(file) }] }] });
  const agent = fakeAgent();
  h.dispatch('agent/status', [{ agent, status: 'idle' }], () => {});
  await h.drain();
  assert.throws(() => readFileSync(file), /ENOENT/, 'a new agent starts idle');
  h.dispatch('agent/status', [{ agent, status: 'running' }], () => {});
  h.dispatch('agent/status', [{ agent, status: 'idle' }], () => {});
  h.dispatch('agent/status', [{ agent, status: 'idle' }], () => {});
  await h.drain();
  await waitFor(() => readLines(file).length >= 1);
  assert.equal(readLines(file).length, 1);
});

test('Notification: the matcher filters by notification type', async () => {
  const file = join(tempDir('dcc-note-'), 'ran');
  const h = harness({ Notification: [{ matcher: 'idle_prompt', hooks: [{ command: `echo ran >> "${file}"` }] }] });
  await h.dispatch('approval/request', [{ agent: fakeAgent(), toolName: 'Bash' }], async () => 'allowed-once');
  await h.drain();
  assert.throws(() => readFileSync(file), /ENOENT/);
});
