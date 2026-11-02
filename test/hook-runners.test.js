// mcp_tool, prompt and agent hook runners (src/hook-runners-model.js), with fake DSH services.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, mcpToolName, substitute } from '../src/hook-runners-model.js';
import { HOOK_CALL_PREFIX } from '../src/hook-support.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeAgent, harness, say, tempDir, textOf, withWarnings } from './hook-kit.js';

const stopping = (agent) => ({ agent, turn: 1, signal: new AbortController().signal });
const allow = async () => ({ kind: 'allow' });
const call = (name, agent) => ({ name, arguments: { file_path: '/p/a.js' }, callId: 'c1', agent });

// An agent that knows its model, as a live DSH agent does.
function modelAgent(id = 's1') {
  const agent = fakeAgent(id);
  agent.session.requestHeader = () => ({ config: { provider: 'prov', model: 'model-1' } });
  return agent;
}

function textChunks(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ];
}

// A fake DSH model service. `answer` is the text, or a function for a custom chunk list.
function fakeLlm(answer) {
  const requests = [];
  return {
    requests,
    stream(options) {
      requests.push(options);
      const chunks = typeof answer === 'function' ? answer(options) : textChunks(answer);
      return (async function* generate() {
        if (chunks instanceof Error) throw chunks;
        yield* chunks;
      })();
    },
  };
}

// ─── mcp_tool: names and substitution ────────────────────────────────────────

test('mcpToolName is mcp__server__tool when both are clean', () => {
  assert.equal(mcpToolName('my_server', 'security_scan'), 'mcp__my_server__security_scan');
});

test('mcpToolName cleans the server name and adds a hash when the name changes', () => {
  const name = mcpToolName('plugin:my-plugin:db', 'run query');
  assert.match(name, /^mcp__plugin_my-plugin_db__run_query_[0-9a-f]{12}$/);
  assert.notEqual(mcpToolName('s', 'a b'), mcpToolName('s', 'a_b'), 'two tools never share a name');
  assert.equal(mcpToolName('a b', 'x'), 'mcp__a_b__x', 'a server name is cleaned before the join, as the mount does');
});

test('mcpToolName cuts a long name to 64 characters', () => {
  const name = mcpToolName('s', 't'.repeat(100));
  assert.equal(name.length, 64);
  assert.match(name, /_[0-9a-f]{12}$/);
});

test('substitute replaces ${path} in strings, deep in objects and arrays', () => {
  const input = { tool_input: { file_path: '/a/b.js', n: 5, list: [1, 2] }, cwd: '/w' };
  assert.deepEqual(substitute({ f: '${tool_input.file_path}', nested: { c: 'in ${cwd}' }, arr: ['${cwd}', 3] }, input), {
    f: '/a/b.js', nested: { c: 'in /w' }, arr: ['/w', 3],
  });
  assert.equal(substitute('${tool_input.n}', input), '5');
  assert.equal(substitute('${tool_input.list}', input), '[1,2]');
});

test('substitute gives an empty string for a missing field, and reads own properties only', () => {
  assert.equal(substitute('[${nope}][${tool_input.missing}][${__proto__}][${constructor.name}]', { tool_input: {} }), '[][][][]');
  assert.equal(substitute('${a.b}', { a: null }), '');
});

test('substitute leaves other values as they are', () => {
  assert.deepEqual(substitute({ a: 1, b: true, c: null }, {}), { a: 1, b: true, c: null });
});

test('buildPrompt replaces every $ARGUMENTS, or appends the input', () => {
  assert.equal(buildPrompt('check $ARGUMENTS and $ARGUMENTS', '{"a":1}'), 'check {"a":1} and {"a":1}');
  assert.equal(buildPrompt('check it', '{"a":1}'), 'check it\n\n{"a":1}');
  assert.equal(buildPrompt('x $ARGUMENTS', '{"p":"$&"}'), 'x {"p":"$&"}', 'a replacement pattern in the input stays text');
});

// ─── mcp_tool runner ─────────────────────────────────────────────────────────

function fakeTools(handler) {
  const calls = [];
  return {
    calls,
    get: (name) => (name.startsWith('mcp__srv__') ? { name } : undefined),
    execute: async (input) => {
      calls.push(input);
      return { results: [{ callId: input.calls[0].id, result: await handler(input) }], additionalContexts: [], concluded: false };
    },
  };
}
const toolResult = (text, isError = false) => ({ isError, content: [{ type: 'text', text }] });
const mcpHook = (extra = {}) => ({ type: 'mcp_tool', server: 'srv', tool: 'scan', input: { path: '${tool_input.file_path}' }, ...extra });

test('an mcp_tool hook calls the tool with the substituted input, and its text is read like stdout', async () => {
  const tools = fakeTools(() => toolResult(JSON.stringify({ decision: 'block', reason: 'unsafe file' })));
  const h = harness({ PostToolUse: [{ matcher: '.*', hooks: [mcpHook()] }] }, { ctx: { tools } });
  const decision = await h.dispatch('tools/post-execute', [call('Write', modelAgent()), { isError: false, value: 'ok', content: [] }], async () => ({ kind: 'accept' }));
  assert.deepEqual(decision, { kind: 'block', feedback: [{ type: 'text', text: 'unsafe file' }] });
  const [sent] = tools.calls;
  assert.equal(sent.calls[0].name, 'mcp__srv__scan');
  assert.deepEqual(JSON.parse(sent.calls[0].arguments), { path: '/p/a.js' });
  assert.ok(sent.calls[0].id.startsWith(HOOK_CALL_PREFIX));
  assert.ok(sent.signal instanceof AbortSignal);
});

test('an mcp_tool hook with plain text output is not a decision on an event that has no stdout context', async () => {
  const tools = fakeTools(() => toolResult('all fine'));
  const h = harness({ PreToolUse: [{ matcher: '.*', hooks: [mcpHook()] }] }, { ctx: { tools } });
  assert.equal((await h.dispatch('tools/pre-execute', [call('Read', modelAgent())], allow)).kind, 'allow');
});

test('an mcp_tool hook on SessionStart adds its text as context', async () => {
  const tools = fakeTools(() => toolResult('remember the schema'));
  const h = harness({ SessionStart: [{ hooks: [mcpHook({ input: {} })] }] }, { ctx: { tools } });
  const agent = modelAgent();
  await h.dispatch('agent/created', [{ agent, source: 'startup' }], () => {});
  assert.equal(textOf(agent.injected[0]), 'remember the schema');
});

test('an mcp_tool hook for a tool that is not registered is a failed run with the tool name', async () => {
  const tools = fakeTools(() => toolResult('x'));
  const h = harness({ PreToolUse: [{ matcher: '.*', hooks: [mcpHook({ server: 'missing' })] }] }, { ctx: { tools } });
  const { value, warnings } = await withWarnings(() => h.dispatch('tools/pre-execute', [call('Read', modelAgent())], allow));
  assert.equal(value.kind, 'allow');
  assert.match(warnings[0], /MCP tool mcp__missing__scan is not available/);
  assert.equal(tools.calls.length, 0);
});

test('an mcp_tool hook whose tool reports an error is a failed run, and onFailure block denies', async () => {
  const tools = fakeTools(() => toolResult('database is down', true));
  const h = harness({ PreToolUse: [{ matcher: '.*', hooks: [mcpHook({ onFailure: 'block' })] }] }, { ctx: { tools } });
  const { value, warnings } = await withWarnings(() => h.dispatch('tools/pre-execute', [call('Read', modelAgent())], allow));
  assert.equal(value.kind, 'deny');
  assert.match(warnings[0], /MCP tool mcp__srv__scan failed: database is down/);
});

test('an mcp_tool hook that throws, or runs too long, is a failed run', async () => {
  const broken = fakeTools(() => { throw new Error('transport closed'); });
  let h = harness({ PreToolUse: [{ matcher: '.*', hooks: [mcpHook()] }] }, { ctx: { tools: broken } });
  let outcome = await withWarnings(() => h.dispatch('tools/pre-execute', [call('Read', modelAgent())], allow));
  assert.match(outcome.warnings[0], /transport closed/);

  const slow = fakeTools((input) => new Promise((_resolve, reject) => {
    input.signal.addEventListener('abort', () => reject(input.signal.reason));
  }));
  h = harness({ PreToolUse: [{ matcher: '.*', hooks: [mcpHook({ timeout: 0.05 })] }] }, { ctx: { tools: slow } });
  outcome = await withWarnings(() => h.dispatch('tools/pre-execute', [call('Read', modelAgent())], allow));
  assert.match(outcome.warnings[0], /timed out after 50ms/);
});

test('the tool call of an mcp_tool hook does not start the hooks again', async () => {
  const h = harness({ PreToolUse: [{ matcher: '.*', hooks: [{ command: 'exit 2' }] }] });
  const own = { name: 'mcp__srv__scan', arguments: {}, callId: `${HOOK_CALL_PREFIX}abc`, agent: modelAgent() };
  assert.equal((await h.dispatch('tools/pre-execute', [own], allow)).kind, 'allow');
  assert.equal((await h.dispatch('tools/pre-execute', [{ ...own, callId: 'other' }], allow)).kind, 'deny');
});

test('an mcp_tool hook runs without an agent, and sends no agent to the tool service', async () => {
  const tools = fakeTools(() => toolResult(''));
  const h = harness({ Notification: [{ hooks: [mcpHook({ input: { n: '${message}' } })] }] }, { ctx: { tools } });
  await h.dispatch('user-questions/request', [{ questions: [] }], async () => 'x');
  await h.drain();
  assert.equal('agent' in tools.calls[0], false);
});

// ─── prompt runner ───────────────────────────────────────────────────────────

const promptHook = (extra = {}) => ({ type: 'prompt', prompt: 'Is this safe? $ARGUMENTS', ...extra });

test('a prompt hook asks the session model, with the hook input in the prompt, and ok true allows', async () => {
  const llm = fakeLlm('{"ok": true}');
  const h = harness({ PreToolUse: [{ matcher: '.*', hooks: [promptHook()] }] }, { ctx: { llm } });
  const decision = await h.dispatch('tools/pre-execute', [call('Bash', modelAgent())], allow);
  assert.equal(decision.kind, 'allow');
  const [request] = llm.requests;
  assert.deepEqual([request.provider, request.model, request.temperature], ['prov', 'model-1', 0]);
  assert.match(request.system, /\{"ok": true\}/);
  assert.doesNotMatch(request.system, /impossible/);
  const text = request.messages[0].content[0].text;
  assert.match(text, /^Is this safe\? \{/);
  assert.equal(JSON.parse(text.slice('Is this safe? '.length)).tool_name, 'Bash');
  assert.ok(request.signal instanceof AbortSignal);
});

test('a prompt hook that answers ok false denies the tool call with its reason', async () => {
  const h = harness({ PreToolUse: [{ matcher: '.*', hooks: [promptHook()] }] }, { ctx: { llm: fakeLlm('{"ok": false, "reason": "reads .env"}') } });
  assert.deepEqual(await h.dispatch('tools/pre-execute', [call('Bash', modelAgent())], allow), { kind: 'deny', reason: 'reads .env' });
});

test('a prompt hook on Stop continues the turn with the reason, and impossible lets the turn end', async () => {
  const blocked = harness({ Stop: [{ hooks: [promptHook()] }] }, { ctx: { llm: fakeLlm('{"ok": false, "reason": "tests missing"}') } });
  const agent = modelAgent();
  await blocked.dispatch('agent/turn-stopping', [stopping(agent)], () => {});
  assert.equal(textOf(agent.steered[0]), 'tests missing');

  const llm = fakeLlm('{"ok": false, "reason": "no repo", "impossible": true}');
  const ended = harness({ Stop: [{ hooks: [promptHook()] }] }, { ctx: { llm } });
  const other = modelAgent();
  await ended.dispatch('agent/turn-stopping', [stopping(other)], () => {});
  assert.equal(other.steered.length, 0);
  assert.match(llm.requests[0].system, /impossible/, 'the model is told about impossible on Stop');
});

test('a prompt hook model can be provider/model, or a model of the session provider', async () => {
  for (const [model, expected] of [['other/m2', ['other', 'm2']], ['m3', ['prov', 'm3']]]) {
    const llm = fakeLlm('{"ok": true}');
    const h = harness({ PreToolUse: [{ matcher: '.*', hooks: [promptHook({ model })] }] }, { ctx: { llm } });
    await h.dispatch('tools/pre-execute', [call('Bash', modelAgent())], allow);
    assert.deepEqual([llm.requests[0].provider, llm.requests[0].model], expected, model);
  }
});

test('a prompt hook falls back to the agent options when the session has no request yet', async () => {
  const llm = fakeLlm('{"ok": true}');
  const h = harness({ PreToolUse: [{ matcher: '.*', hooks: [promptHook()] }] }, { ctx: { llm } });
  const agent = fakeAgent();
  agent.options = { provider: 'opt-prov', model: 'opt-model' };
  await h.dispatch('tools/pre-execute', [call('Bash', agent)], allow);
  assert.deepEqual([llm.requests[0].provider, llm.requests[0].model], ['opt-prov', 'opt-model']);
});

test('a prompt hook with no known model fails with a fix', async () => {
  const h = harness({ PreToolUse: [{ matcher: '.*', hooks: [promptHook()] }] }, { ctx: { llm: fakeLlm('{"ok": true}') } });
  const { value, warnings } = await withWarnings(() => h.dispatch('tools/pre-execute', [call('Bash', fakeAgent())], allow));
  assert.equal(value.kind, 'allow');
  assert.match(warnings[0], /no model is known for this prompt hook; set "model" as provider\/model/);
});

test('a prompt hook with no model service fails', async () => {
  const h = harness({ PreToolUse: [{ matcher: '.*', hooks: [promptHook()] }] });
  const { warnings } = await withWarnings(() => h.dispatch('tools/pre-execute', [call('Bash', modelAgent())], allow));
  assert.match(warnings[0], /model service is not available/);
});

test('a prompt hook answer that is not a verdict is a failed run that says why', async () => {
  const h = harness({ PreToolUse: [{ matcher: '.*', hooks: [promptHook({ onFailure: 'block' })] }] }, { ctx: { llm: fakeLlm('Looks fine to me') } });
  const { value, warnings } = await withWarnings(() => h.dispatch('tools/pre-execute', [call('Bash', modelAgent())], allow));
  assert.equal(value.kind, 'deny');
  assert.match(warnings[0], /prompt hook answer: the answer is not a JSON object/);
});

test('a prompt hook whose model call fails, or throws, is a failed run', async () => {
  const failing = fakeLlm(() => [{ type: 'finish', reason: { kind: 'error', failure: { message: 'rate limited', code: 'RATE_LIMIT' } } }]);
  let h = harness({ PreToolUse: [{ matcher: '.*', hooks: [promptHook()] }] }, { ctx: { llm: failing } });
  let outcome = await withWarnings(() => h.dispatch('tools/pre-execute', [call('Bash', modelAgent())], allow));
  assert.match(outcome.warnings[0], /model call failed: rate limited/);

  const aborted = fakeLlm(() => [{ type: 'finish', reason: { kind: 'aborted', failure: { message: 'cancelled', code: 'ABORTED' } } }]);
  h = harness({ PreToolUse: [{ matcher: '.*', hooks: [promptHook()] }] }, { ctx: { llm: aborted } });
  outcome = await withWarnings(() => h.dispatch('tools/pre-execute', [call('Bash', modelAgent())], allow));
  assert.match(outcome.warnings[0], /cancelled or timed out/);

  const throwing = fakeLlm(() => new Error('socket hang up'));
  h = harness({ PreToolUse: [{ matcher: '.*', hooks: [promptHook()] }] }, { ctx: { llm: throwing } });
  outcome = await withWarnings(() => h.dispatch('tools/pre-execute', [call('Bash', modelAgent())], allow));
  assert.match(outcome.warnings[0], /socket hang up/);
});

test('a prompt hook uses its own timeout, 30 seconds by default', async () => {
  const llm = fakeLlm('{"ok": true}');
  const h = harness({ PreToolUse: [{ matcher: '.*', hooks: [promptHook({ timeout: 7 })] }] }, { ctx: { llm } });
  await h.dispatch('tools/pre-execute', [call('Bash', modelAgent())], allow);
  assert.equal(llm.requests.length, 1);
});

test('a prompt hook that answers ok false on PermissionRequest rejects the approval', async () => {
  const h = harness({ PermissionRequest: [{ matcher: '.*', hooks: [promptHook()] }] }, { ctx: { llm: fakeLlm('{"ok": false, "reason": "no"}') } });
  const { value } = await withWarnings(() => h.dispatch('approval/request', [{ agent: modelAgent(), toolName: 'Bash', callId: 'c1' }], async () => 'allowed-once'));
  assert.equal(value, 'rejected');
});

// ─── agent runner ────────────────────────────────────────────────────────────

function fakeSubagents(behavior) {
  const started = [];
  const disposed = [];
  return {
    started,
    disposed,
    getProvider: (name) => (name === 'spawn' ? {} : undefined),
    startActivation: async (spec) => {
      started.push(spec);
      const result = behavior(spec);
      return { childId: spec.childId, result: result instanceof Promise ? result : Promise.resolve(result), dispose: async () => { disposed.push(spec.childId); } };
    },
  };
}
const completed = (structured) => ({ stopReason: 'completed', output: [], structured });
const agentHook = (extra = {}) => ({ type: 'agent', prompt: 'Verify the tests pass. $ARGUMENTS', ...extra });

test('an agent hook starts a subagent with the hook input, and its structured answer decides', async () => {
  const subagents = fakeSubagents(() => completed({ ok: false, reason: '3 tests fail' }));
  const h = harness({ Stop: [{ hooks: [agentHook()] }] }, { ctx: { subagents } });
  const agent = modelAgent('s7');
  await h.dispatch('agent/turn-stopping', [stopping(agent)], () => {});
  assert.equal(textOf(agent.steered[0]), '3 tests fail');
  const [spec] = subagents.started;
  assert.deepEqual([spec.provider, spec.delivery], ['spawn', 'caller']);
  assert.equal(spec.request.parent, agent);
  assert.match(spec.request.prompt[0].text, /^Verify the tests pass\. \{/);
  assert.match(spec.request.prompt[0].text, /Do not change any file/);
  assert.deepEqual(spec.request.outputSchema.required, ['ok']);
  assert.ok(spec.signal instanceof AbortSignal);
  assert.deepEqual(subagents.disposed, [spec.childId], 'the subagent is stopped when the run ends');
});

test('an agent hook with ok true lets the turn end', async () => {
  const h = harness({ Stop: [{ hooks: [agentHook()] }] }, { ctx: { subagents: fakeSubagents(() => completed({ ok: true })) } });
  const agent = modelAgent();
  await h.dispatch('agent/turn-stopping', [stopping(agent)], () => {});
  assert.equal(agent.steered.length, 0);
});

test('an agent hook reads a text answer when the subagent returns no structured value', async () => {
  const subagents = fakeSubagents(() => ({ stopReason: 'completed', output: [{ type: 'text', text: '{"ok": false, "reason": "from text"}' }] }));
  const h = harness({ Stop: [{ hooks: [agentHook()] }] }, { ctx: { subagents } });
  const agent = modelAgent();
  await h.dispatch('agent/turn-stopping', [stopping(agent)], () => {});
  assert.equal(textOf(agent.steered[0]), 'from text');
});

test('an agent hook ignores impossible, so the turn goes on', async () => {
  const h = harness({ Stop: [{ hooks: [agentHook()] }] }, { ctx: { subagents: fakeSubagents(() => completed({ ok: false, reason: 'r', impossible: true })) } });
  const agent = modelAgent();
  await h.dispatch('agent/turn-stopping', [stopping(agent)], () => {});
  assert.equal(agent.steered.length, 1);
});

test('an agent hook that ends in any way but completed is a failed run', async () => {
  const subagents = fakeSubagents(() => ({ stopReason: 'error', output: [] }));
  const h = harness({ PreToolUse: [{ matcher: '.*', hooks: [agentHook({ onFailure: 'block' })] }] }, { ctx: { subagents } });
  const { value, warnings } = await withWarnings(() => h.dispatch('tools/pre-execute', [call('Bash', modelAgent())], allow));
  assert.equal(value.kind, 'deny');
  assert.match(warnings[0], /agent hook: the subagent ended with error/);
});

test('an agent hook with no spawn provider, or no running agent, fails with a reason', async () => {
  const none = { getProvider: () => undefined, startActivation: async () => { throw new Error('unused'); } };
  let h = harness({ PreToolUse: [{ matcher: '.*', hooks: [agentHook()] }] }, { ctx: { subagents: none } });
  let outcome = await withWarnings(() => h.dispatch('tools/pre-execute', [call('Bash', modelAgent())], allow));
  assert.match(outcome.warnings[0], /no "spawn" subagent provider is registered/);

  const subagents = fakeSubagents(() => completed({ ok: true }));
  h = harness({ UserPromptExpansion: [{ hooks: [agentHook()] }] }, { ctx: { subagents } });
  outcome = await withWarnings(async () => {
    await h.dispatch('session/event', [{ id: 's', header: { id: 's', cwd: '/w' } }, { type: 'command/run', seq: 1, time: 0, data: { commandId: 'c', name: 'x', source: 'user' } }], () => {});
    await h.drain();
  });
  assert.match(outcome.warnings[0], /needs a running agent/);
  assert.equal(subagents.started.length, 0);
});

test('an agent hook that runs too long is stopped and reported', async () => {
  const subagents = fakeSubagents(() => new Promise(() => {}));
  const h = harness({ PreToolUse: [{ matcher: '.*', hooks: [agentHook({ timeout: 0.05 })] }] }, { ctx: { subagents } });
  const { value, warnings } = await withWarnings(() => h.dispatch('tools/pre-execute', [call('Bash', modelAgent())], allow));
  assert.equal(value.kind, 'allow');
  assert.match(warnings.join('\n'), /agent hook: timed out after 50ms/);
  assert.equal(subagents.disposed.length, 1, 'the subagent is disposed after the timeout');
  assert.equal(subagents.started[0].signal.aborted, true);
});

test('an agent hook whose subagent is slow to start is still stopped when it arrives', async () => {
  const disposed = [];
  const subagents = {
    getProvider: () => ({}),
    startActivation: () => new Promise((resolve) => {
      setTimeout(() => resolve({ childId: 'late', result: new Promise(() => {}), dispose: async () => { disposed.push('late'); } }), 150);
    }),
  };
  const h = harness({ PreToolUse: [{ matcher: '.*', hooks: [agentHook({ timeout: 0.03 })] }] }, { ctx: { subagents } });
  await withWarnings(() => h.dispatch('tools/pre-execute', [call('Bash', modelAgent())], allow));
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(disposed, ['late']);
});

test('no hook runs inside the subagent of an agent hook, and the subagent is forgotten after the run', async () => {
  const ran = [];
  let childId;
  const subagents = fakeSubagents((spec) => {
    childId = spec.childId;
    return (async () => {
      // The child calls a tool while the hook is running. The configured PreToolUse hook must not run for it.
      const child = fakeAgent(spec.childId);
      const decision = await h.dispatch('tools/pre-execute', [call('Read', child)], allow);
      ran.push(decision.kind);
      return completed({ ok: true });
    })();
  });
  const h = harness({
    PreToolUse: [{ matcher: 'Bash', hooks: [agentHook()] }, { matcher: 'Read', hooks: [{ command: 'exit 2' }] }],
    SubagentStart: [{ hooks: [{ command: 'exit 2' }] }],
  }, { ctx: { subagents } });
  await h.dispatch('tools/pre-execute', [call('Bash', modelAgent())], allow);
  assert.deepEqual(ran, ['allow'], 'the Read hook that exits 2 did not run for the child');
  h.dispatch('subagent/start', [{ runId: 'r', provider: 'spawn', id: childId, local: true }], () => {});
  await h.drain();
  const afterRun = await h.dispatch('tools/pre-execute', [call('Read', fakeAgent(childId))], allow);
  assert.equal(afterRun.kind, 'deny', 'a later agent with that id is no longer muted');
});

test('the subagent start and end events of an agent hook do not run SubagentStart or SubagentStop hooks', async () => {
  const ran = join(tempDir('dcc-sub-'), 'ran');
  const h = harness({
    SubagentStart: [{ hooks: [{ command: `echo start >> "${ran}"` }] }],
    SubagentStop: [{ hooks: [{ command: `echo stop >> "${ran}"` }] }],
    Stop: [{ hooks: [agentHook()] }],
  }, {
    ctx: {
      subagents: fakeSubagents((spec) => {
        // The events of the child arrive while the hook run is open.
        h.dispatch('subagent/start', [{ runId: 'r', provider: 'spawn', id: spec.childId, local: true }], () => {});
        h.dispatch('subagent/end', [{ runId: 'r', provider: 'spawn', id: spec.childId, local: true, stopReason: 'completed' }], () => {});
        return completed({ ok: true });
      }),
    },
  });
  await h.dispatch('agent/turn-stopping', [stopping(modelAgent())], () => {});
  await h.drain();
  assert.throws(() => readFileSync(ran), /ENOENT/);
  h.dispatch('subagent/start', [{ runId: 'r2', provider: 'spawn', id: 'someone-else', local: true }], () => {});
  await h.drain();
  assert.equal(readFileSync(ran, 'utf8').trim(), 'start', 'an ordinary subagent still runs the hook');
});

test('the runners reject nothing: say() output from a command still works beside them', async () => {
  const h = harness({ PreToolUse: [{ matcher: '.*', hooks: [{ command: say({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'c' } }) }] }] });
  assert.equal((await h.dispatch('tools/pre-execute', [call('Bash', modelAgent())], allow)).kind, 'deny');
});
