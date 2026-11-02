// Hooks that DSH reports after the fact (session/event feed), PostModelSwitch,
// TeammateIdle and InstructionsLoaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeAgent, fakeSubagent, harness, say, tempDir, textOf, withWarnings } from './hook-kit.js';

const logTo = (file) => `cat | tr -d '\\n' >> "${file}"; echo >> "${file}"`;
const readLines = (file) => readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
const session = (id = 's1', cwd = '/work') => ({ id, header: { id, cwd } });
const feed = (h, sessionObject, type, data) => h.dispatch('session/event', [sessionObject, { type, seq: 1, time: 0, data }], () => {});

// ─── CwdChanged ──────────────────────────────────────────────────────────────

test('CwdChanged sends the old and the new directory, and the old one follows the last change', async () => {
  const file = join(tempDir('dcc-cwd-'), 'lines');
  const h = harness({ CwdChanged: [{ hooks: [{ command: logTo(file) }] }] });
  const s = session('s1', '/start');
  await feed(h, s, 'working-directory/change', { cwd: '/a' });
  await feed(h, s, 'working-directory/change', { cwd: '/b' });
  await h.drain();
  const calls = readLines(file);
  assert.deepEqual(calls.map((call) => [call.hook_event_name, call.old_cwd, call.new_cwd, call.session_id]), [
    ['CwdChanged', '/start', '/a', 's1'],
    ['CwdChanged', '/a', '/b', 's1'],
  ]);
});

test('CwdChanged ignores other session events', async () => {
  const file = join(tempDir('dcc-cwd-'), 'ran');
  const h = harness({ CwdChanged: [{ hooks: [{ command: `echo ran >> "${file}"` }] }] });
  await feed(h, session(), 'user/message', {});
  await h.drain();
  assert.throws(() => readFileSync(file), /ENOENT/);
});

// ─── compaction ──────────────────────────────────────────────────────────────

test('PreCompact: a compaction with a source command is manual, and custom_instructions is the command text', async () => {
  const file = join(tempDir('dcc-compact-'), 'lines');
  const h = harness({ PreCompact: [{ matcher: 'manual', hooks: [{ command: logTo(file) }] }] });
  const s = session();
  await feed(h, s, 'command/run', { commandId: 'cmd-1', name: 'compact', args: 'keep the plan', source: 'user' });
  await feed(h, s, 'compaction/start', { compactionId: 'c1', sourceCommandId: 'cmd-1', turn: 3 });
  await h.drain();
  const [call] = readLines(file);
  assert.deepEqual([call.hook_event_name, call.trigger, call.custom_instructions], ['PreCompact', 'manual', 'keep the plan']);
});

test('PreCompact: an automatic compaction has trigger auto and null instructions, and the matcher filters', async () => {
  const file = join(tempDir('dcc-compact-'), 'lines');
  const h = harness({
    PreCompact: [
      { matcher: 'auto', hooks: [{ command: logTo(file) }] },
      { matcher: 'manual', hooks: [{ command: 'exit 9' }] },
    ],
  });
  await feed(h, session(), 'compaction/start', { compactionId: 'c1', turn: 3 });
  await h.drain();
  const calls = readLines(file);
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].trigger, calls[0].custom_instructions], ['auto', null]);
});

test('PreCompact: a manual compaction with no arguments has null instructions', async () => {
  const file = join(tempDir('dcc-compact-'), 'lines');
  const h = harness({ PreCompact: [{ hooks: [{ command: logTo(file) }] }] });
  await feed(h, session(), 'command/run', { commandId: 'cmd-2', name: 'compact', source: 'user' });
  await feed(h, session(), 'compaction/start', { compactionId: 'c1', sourceCommandId: 'cmd-2', turn: 1 });
  await h.drain();
  assert.equal(readLines(file)[0].custom_instructions, null);
});

test('PreCompact: a hook that blocks is warned, because DSH reports the compaction after it started', async () => {
  const h = harness({ PreCompact: [{ hooks: [{ command: 'exit 2' }] }] });
  const { warnings } = await withWarnings(async () => {
    await feed(h, session(), 'compaction/start', { compactionId: 'c1', turn: 1 });
    await h.drain();
  });
  assert.match(warnings[0], /PreCompact hook asked to block compaction/);
});

test('PostCompact runs when the compaction ends, with the summary', async () => {
  const file = join(tempDir('dcc-compact-'), 'lines');
  const h = harness({ PostCompact: [{ hooks: [{ command: logTo(file) }] }] });
  const s = session();
  await feed(h, s, 'compaction/start', { compactionId: 'c1', turn: 2 });
  await feed(h, s, 'compaction/summary', { compactionId: 'c1', summary: 'we fixed the bug' });
  await feed(h, s, 'compaction/end', { compactionId: 'c1', turn: 2 });
  await h.drain();
  const [call] = readLines(file);
  assert.deepEqual([call.hook_event_name, call.trigger, call.compact_summary], ['PostCompact', 'auto', 'we fixed the bug']);
});

test('PostCompact does not run for a compaction that failed', async () => {
  const file = join(tempDir('dcc-compact-'), 'ran');
  const h = harness({ PostCompact: [{ hooks: [{ command: `echo ran >> "${file}"` }] }] });
  await feed(h, session(), 'compaction/end', { compactionId: 'c1', turn: 2, error: 'model failed' });
  await h.drain();
  assert.throws(() => readFileSync(file), /ENOENT/);
});

test('PostCompact: the summary of one compaction does not reach the next', async () => {
  const file = join(tempDir('dcc-compact-'), 'lines');
  const h = harness({ PostCompact: [{ hooks: [{ command: logTo(file) }] }] });
  const s = session();
  await feed(h, s, 'compaction/summary', { compactionId: 'c1', summary: 'first' });
  await feed(h, s, 'compaction/end', { compactionId: 'c1', turn: 1 });
  await feed(h, s, 'compaction/end', { compactionId: 'c1', turn: 1 });
  await h.drain();
  assert.deepEqual(readLines(file).map((call) => call.compact_summary), ['first', '']);
});

// ─── UserPromptExpansion ─────────────────────────────────────────────────────

test('UserPromptExpansion runs for a command, with its name as matcher subject', async () => {
  const file = join(tempDir('dcc-expand-'), 'lines');
  const h = harness({
    UserPromptExpansion: [
      { matcher: 'review', hooks: [{ command: logTo(file) }] },
      { matcher: 'other', hooks: [{ command: 'exit 9' }] },
    ],
  });
  await feed(h, session(), 'command/run', { commandId: 'c', name: 'review', args: 'src/', source: 'user' });
  await h.drain();
  const calls = readLines(file);
  assert.equal(calls.length, 1);
  assert.deepEqual(
    [calls[0].expansion_type, calls[0].command_name, calls[0].command_args, calls[0].prompt],
    ['slash_command', 'review', 'src/', '/review src/'],
  );
});

test('UserPromptExpansion: a command with no arguments has an empty args field and a bare prompt', async () => {
  const file = join(tempDir('dcc-expand-'), 'lines');
  const h = harness({ UserPromptExpansion: [{ hooks: [{ command: logTo(file) }] }] });
  await feed(h, session(), 'command/run', { commandId: 'c', name: 'status', source: 'user' });
  await h.drain();
  assert.deepEqual([readLines(file)[0].command_args, readLines(file)[0].prompt], ['', '/status']);
});

// ─── PostModelSwitch ─────────────────────────────────────────────────────────

const stepWith = (agent, model, messages = []) => ({ agent, messages, modelSelection: { provider: 'p', model } });
const enter = async () => ({ kind: 'enter', messages: [{ content: [{ type: 'text', text: 'user' }] }] });

test('PostModelSwitch: the first step is a baseline, and a later change runs the hook', async () => {
  const file = join(tempDir('dcc-model-'), 'lines');
  const h = harness({ PostModelSwitch: [{ hooks: [{ command: logTo(file) }] }] });
  const agent = fakeAgent('s2');
  await h.dispatch('agent/pre-step', [stepWith(agent, 'model-a')], enter);
  await h.dispatch('agent/pre-step', [stepWith(agent, 'model-a')], enter);
  await h.dispatch('agent/pre-step', [stepWith(agent, 'model-b')], enter);
  await h.dispatch('agent/pre-step', [stepWith(agent, 'model-b')], enter);
  const calls = readLines(file);
  assert.equal(calls.length, 1);
  assert.deepEqual(
    [calls[0].hook_event_name, calls[0].from_model, calls[0].to_model, calls[0].session_id],
    ['PostModelSwitch', 'model-a', 'model-b', 's2'],
  );
});

test('PostModelSwitch: stdout becomes context on the step after the switch', async () => {
  const h = harness({ PostModelSwitch: [{ hooks: [{ command: 'printf prefer-short-answers' }] }] });
  const agent = fakeAgent();
  await h.dispatch('agent/pre-step', [stepWith(agent, 'a')], enter);
  const decision = await h.dispatch('agent/pre-step', [stepWith(agent, 'b')], enter);
  assert.equal(decision.messages.length, 2);
  assert.equal(textOf(decision.messages[1]), 'prefer-short-answers');
});

test('PostModelSwitch: the matcher is the new model', async () => {
  const file = join(tempDir('dcc-model-'), 'ran');
  const h = harness({ PostModelSwitch: [{ matcher: '.*opus.*', hooks: [{ command: `echo ran >> "${file}"` }] }] });
  const agent = fakeAgent();
  await h.dispatch('agent/pre-step', [stepWith(agent, 'sonnet')], enter);
  await h.dispatch('agent/pre-step', [stepWith(agent, 'haiku')], enter);
  assert.throws(() => readFileSync(file), /ENOENT/);
  await h.dispatch('agent/pre-step', [stepWith(agent, 'opus-5')], enter);
  assert.equal(readFileSync(file, 'utf8').trim(), 'ran');
});

test('PostModelSwitch: each session keeps its own model', async () => {
  const file = join(tempDir('dcc-model-'), 'ran');
  const h = harness({ PostModelSwitch: [{ hooks: [{ command: `echo ran >> "${file}"` }] }] });
  await h.dispatch('agent/pre-step', [stepWith(fakeAgent('one'), 'a')], enter);
  await h.dispatch('agent/pre-step', [stepWith(fakeAgent('two'), 'b')], enter);
  assert.throws(() => readFileSync(file), /ENOENT/, 'a different model in another session is not a switch');
});

test('PostModelSwitch: a step with no model selection, and a subagent step, are passed through', async () => {
  const file = join(tempDir('dcc-model-'), 'ran');
  const h = harness({ PostModelSwitch: [{ hooks: [{ command: `echo ran >> "${file}"` }] }] });
  const agent = fakeAgent();
  await h.dispatch('agent/pre-step', [stepWith(agent, 'a')], enter);
  const decision = await h.dispatch('agent/pre-step', [{ agent, messages: [] }], enter);
  assert.equal(decision.kind, 'enter');
  const child = fakeSubagent();
  await h.dispatch('agent/pre-step', [stepWith(child, 'a')], enter);
  await h.dispatch('agent/pre-step', [stepWith(child, 'b')], enter);
  assert.throws(() => readFileSync(file), /ENOENT/);
});

// ─── TeammateIdle ────────────────────────────────────────────────────────────

const member = (id, name) => ({ teamId: 'team-1', member: { id, name, phase: 'active' } });

test('TeammateIdle runs when a team member goes from running to idle', async () => {
  const file = join(tempDir('dcc-team-'), 'lines');
  const h = harness({ TeammateIdle: [{ hooks: [{ command: logTo(file) }] }] });
  await feed(h, session('lead'), 'team/member', member('mate-1', 'researcher'));
  const mate = fakeAgent('mate-1');
  h.dispatch('agent/status', [{ agent: mate, status: 'idle' }], () => {});
  h.dispatch('agent/status', [{ agent: mate, status: 'running' }], () => {});
  h.dispatch('agent/status', [{ agent: mate, status: 'idle' }], () => {});
  await h.drain();
  const calls = readLines(file);
  assert.equal(calls.length, 1, 'the first idle is not a finished run');
  assert.deepEqual([calls[0].hook_event_name, calls[0].teammate_name, calls[0].team_name], ['TeammateIdle', 'researcher', 'team-1']);
});

test('TeammateIdle: exit 2 steers the teammate to keep working', async () => {
  const h = harness({ TeammateIdle: [{ hooks: [{ command: 'echo tests are still red >&2; exit 2' }] }] });
  await feed(h, session('lead'), 'team/member', member('mate-1', 'builder'));
  const mate = fakeAgent('mate-1');
  h.dispatch('agent/status', [{ agent: mate, status: 'running' }], () => {});
  h.dispatch('agent/status', [{ agent: mate, status: 'idle' }], () => {});
  await h.drain();
  assert.equal(textOf(mate.steered[0]), 'tests are still red');
});

test('TeammateIdle does not run for an agent that is not a team member', async () => {
  const file = join(tempDir('dcc-team-'), 'ran');
  const h = harness({ TeammateIdle: [{ hooks: [{ command: `echo ran >> "${file}"` }] }] });
  const other = fakeAgent('stranger');
  h.dispatch('agent/status', [{ agent: other, status: 'running' }], () => {});
  h.dispatch('agent/status', [{ agent: other, status: 'idle' }], () => {});
  await h.drain();
  assert.throws(() => readFileSync(file), /ENOENT/);
});

// ─── InstructionsLoaded ──────────────────────────────────────────────────────

test('InstructionsLoaded runs once per rules file, with the scope and the load reason', async () => {
  const file = join(tempDir('dcc-instr-'), 'lines');
  const h = harness({ InstructionsLoaded: [{ hooks: [{ command: logTo(file) }] }] });
  h.instructionsLoaded(fakeAgent('s3'), [
    { path: '/proj/.claude/rules/a.md', scope: 'Project' },
    { path: '/home/.claude/rules/b.md', scope: 'User' },
  ]);
  await h.drain();
  assert.deepEqual(readLines(file).map((call) => [call.hook_event_name, call.file_path, call.memory_type, call.load_reason, call.session_id]), [
    ['InstructionsLoaded', '/proj/.claude/rules/a.md', 'Project', 'session_start', 's3'],
    ['InstructionsLoaded', '/home/.claude/rules/b.md', 'User', 'session_start', 's3'],
  ]);
});

test('InstructionsLoaded with no hook configured runs nothing', async () => {
  const h = harness({ PreToolUse: [{ matcher: '.*', hooks: [{ command: 'exit 0' }] }] });
  h.instructionsLoaded(fakeAgent(), [{ path: '/x.md', scope: 'User' }]);
  await h.drain();
  assert.ok(true);
});

test('InstructionsLoaded: a hook that outputs JSON is read like the other observe-only events', async () => {
  const h = harness({ InstructionsLoaded: [{ hooks: [{ command: say({ systemMessage: 'loaded' }) }] }] });
  h.instructionsLoaded(fakeAgent(), [{ path: '/x.md', scope: 'User' }]);
  await h.drain();
  assert.ok(true);
});

test('PreCompact: only the most recent commands are remembered, so the memory stays bounded', async () => {
  const file = join(tempDir('dcc-compact-'), 'lines');
  const h = harness({ PreCompact: [{ hooks: [{ command: logTo(file) }] }] });
  const s = session();
  for (let i = 0; i <= 60; i += 1) await feed(h, s, 'command/run', { commandId: `cmd-${i}`, name: 'x', args: `args ${i}`, source: 'user' });
  await feed(h, s, 'compaction/start', { compactionId: 'old', sourceCommandId: 'cmd-0', turn: 1 });
  await feed(h, s, 'compaction/start', { compactionId: 'new', sourceCommandId: 'cmd-60', turn: 1 });
  await h.drain();
  assert.deepEqual(readLines(file).map((call) => call.custom_instructions), [null, 'args 60']);
});
