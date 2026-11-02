// Hook output rules (src/hook-output.js). Each case is a rule from the Claude Code
// hooks reference: exit codes, universal JSON fields, and per-event decisions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretRun, mergeOutcomes } from '../src/hook-output.js';

const run = (exitCode, stdout = '', extra = {}) => ({ exitCode, stdout, failed: false, ...extra });
const json = (value) => JSON.stringify(value);

// ─── exit codes ──────────────────────────────────────────────────────────────

test('exit 2 blocks the events that can block, with the output as the reason', () => {
  for (const event of ['user-prompt-submit', 'pre-tool-use', 'post-tool-batch', 'subagent-stop', 'task-created',
    'task-completed', 'stop', 'teammate-idle', 'config-change', 'pre-compact', 'pre-model-switch']) {
    const outcome = interpretRun(event, 'X', run(2, 'not allowed'));
    assert.equal(outcome.blocked, true, event);
    assert.equal(outcome.reason, 'not allowed', event);
  }
});

test('exit 2 does not block an event that cannot block', () => {
  for (const event of ['session-start', 'notification', 'post-compact', 'cwd-changed', 'stop-failure']) {
    assert.equal(interpretRun(event, 'X', run(2, 'x')).blocked, false, event);
  }
});

test('exit 2 with no output still blocks, with no reason so the bridge can supply one', () => {
  const outcome = interpretRun('pre-tool-use', 'PreToolUse', run(2));
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.reason, undefined);
});

test('exit 0 with no output changes nothing', () => {
  const outcome = interpretRun('pre-tool-use', 'PreToolUse', run(0));
  assert.deepEqual([outcome.blocked, outcome.permission, outcome.contexts, outcome.failed], [false, undefined, [], false]);
});

test('a failed run is not interpreted; its reason is kept', () => {
  const outcome = interpretRun('pre-tool-use', 'PreToolUse', { exitCode: 1, stdout: '{"decision":"block"}', failed: true, reason: 'exit 1' });
  assert.deepEqual([outcome.failed, outcome.blocked, outcome.reason], [true, false, 'exit 1']);
});

// ─── plain stdout as context ─────────────────────────────────────────────────

test('plain stdout on exit 0 is context on the four events that take it', () => {
  for (const event of ['user-prompt-submit', 'user-prompt-expansion', 'session-start', 'post-model-switch']) {
    assert.deepEqual(interpretRun(event, 'X', run(0, 'remember this')).contexts, ['remember this'], event);
  }
});

test('plain stdout is not context on other events', () => {
  for (const event of ['pre-tool-use', 'post-tool-use', 'stop', 'notification']) {
    assert.deepEqual(interpretRun(event, 'X', run(0, 'text')).contexts, [], event);
  }
});

// ─── universal JSON fields ───────────────────────────────────────────────────

test('continue:false and stopReason are read on any event', () => {
  const outcome = interpretRun('stop', 'Stop', run(0, json({ continue: false, stopReason: 'done here' })));
  assert.deepEqual([outcome.stopped, outcome.stopReason], [true, 'done here']);
});

test('systemMessage is kept', () => {
  assert.equal(interpretRun('stop', 'Stop', run(0, json({ systemMessage: 'careful' }))).systemMessage, 'careful');
});

test('decision:block with a reason blocks the events that accept it', () => {
  for (const event of ['user-prompt-submit', 'post-tool-use', 'post-tool-batch', 'stop', 'subagent-stop', 'config-change', 'pre-compact']) {
    const outcome = interpretRun(event, 'X', run(0, json({ decision: 'block', reason: 'because' })));
    assert.deepEqual([outcome.blocked, outcome.reason], [true, 'because'], event);
  }
});

test('decision:block is ignored on an event that does not accept it', () => {
  assert.equal(interpretRun('session-start', 'SessionStart', run(0, json({ decision: 'block' }))).blocked, false);
});

test('output that is not a JSON object is treated as text', () => {
  for (const text of ['[1,2]', '"x"', '{broken', '42']) {
    const outcome = interpretRun('stop', 'Stop', run(0, text));
    assert.deepEqual([outcome.blocked, outcome.stopped], [false, false], text);
  }
});

// ─── additionalContext ───────────────────────────────────────────────────────

test('additionalContext is read from hookSpecificOutput and from the top level', () => {
  assert.deepEqual(
    interpretRun('post-tool-use', 'PostToolUse', run(0, json({ hookSpecificOutput: { additionalContext: 'a' } }))).contexts,
    ['a'],
  );
  assert.deepEqual(interpretRun('post-tool-use', 'PostToolUse', run(0, json({ additionalContext: 'b' }))).contexts, ['b']);
});

test('a hookSpecificOutput block for another event is dropped', () => {
  const stdout = json({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'wrong' } });
  assert.deepEqual(interpretRun('post-tool-use', 'PostToolUse', run(0, stdout)).contexts, []);
});

// ─── PreToolUse ──────────────────────────────────────────────────────────────

test('PreToolUse permissionDecision and its reason are read', () => {
  for (const decision of ['allow', 'deny', 'ask', 'defer']) {
    const stdout = json({ hookSpecificOutput: { permissionDecision: decision, permissionDecisionReason: 'why' } });
    const outcome = interpretRun('pre-tool-use', 'PreToolUse', run(0, stdout));
    assert.deepEqual([outcome.permission, outcome.permissionReason], [decision, 'why'], decision);
  }
});

test('PreToolUse maps the deprecated top-level decision: approve to allow, block to deny', () => {
  assert.equal(interpretRun('pre-tool-use', 'PreToolUse', run(0, json({ decision: 'approve' }))).permission, 'allow');
  const denied = interpretRun('pre-tool-use', 'PreToolUse', run(0, json({ decision: 'block', reason: 'no' })));
  assert.deepEqual([denied.permission, denied.permissionReason], ['deny', 'no']);
});

test('PreToolUse updatedInput is read', () => {
  const stdout = json({ hookSpecificOutput: { updatedInput: { command: 'ls' } } });
  assert.deepEqual(interpretRun('pre-tool-use', 'PreToolUse', run(0, stdout)).updatedInput, { command: 'ls' });
});

// ─── other event fields ──────────────────────────────────────────────────────

test('PostToolUse updatedToolOutput, PermissionDenied retry and watchPaths are read', () => {
  assert.equal(
    interpretRun('post-tool-use', 'PostToolUse', run(0, json({ hookSpecificOutput: { updatedToolOutput: 'new' } }))).updatedToolOutput,
    'new',
  );
  assert.equal(
    interpretRun('permission-denied', 'PermissionDenied', run(0, json({ hookSpecificOutput: { retry: true } }))).retry,
    true,
  );
  assert.deepEqual(
    interpretRun('cwd-changed', 'CwdChanged', run(0, json({ hookSpecificOutput: { watchPaths: ['/a', 3, '/b'] } }))).watchPaths,
    ['/a', '/b'],
  );
});

test('other hookSpecificOutput fields are passed through for the bridges', () => {
  const stdout = json({ hookSpecificOutput: { decision: { behavior: 'allow' }, action: 'accept', content: { a: 1 } } });
  const outcome = interpretRun('permission-request', 'PermissionRequest', run(0, stdout));
  assert.deepEqual(outcome.specific.decision, { behavior: 'allow' });
});

// ─── mergeOutcomes ───────────────────────────────────────────────────────────

const outcomeOf = (event, stdout, exitCode = 0) => interpretRun(event, 'X', run(exitCode, stdout));

test('merging: any block wins, and the first reason is kept', () => {
  const merged = mergeOutcomes([outcomeOf('stop', '', 0), outcomeOf('stop', 'first', 2), outcomeOf('stop', 'second', 2)]);
  assert.deepEqual([merged.blocked, merged.reason], [true, 'first']);
});

test('merging: permission follows deny > defer > ask > allow', () => {
  const decide = (permission) => outcomeOf('pre-tool-use', json({ hookSpecificOutput: { permissionDecision: permission } }));
  assert.equal(mergeOutcomes([decide('allow'), decide('ask')]).permission, 'ask');
  assert.equal(mergeOutcomes([decide('ask'), decide('defer')]).permission, 'defer');
  assert.equal(mergeOutcomes([decide('deny'), decide('allow'), decide('ask')]).permission, 'deny');
  assert.equal(mergeOutcomes([decide('allow')]).permission, 'allow');
});

test('merging: contexts and watch paths are joined without duplicates', () => {
  const a = outcomeOf('cwd-changed', json({ hookSpecificOutput: { additionalContext: 'one', watchPaths: ['/a', '/b'] } }));
  const b = outcomeOf('cwd-changed', json({ hookSpecificOutput: { additionalContext: 'two', watchPaths: ['/b', '/c'] } }));
  const merged = mergeOutcomes([a, b]);
  assert.deepEqual(merged.contexts, ['one', 'two']);
  assert.deepEqual(merged.watchPaths, ['/a', '/b', '/c']);
});

test('merging: the last updated input or output wins; failed runs are skipped', () => {
  const update = (value) => outcomeOf('pre-tool-use', json({ hookSpecificOutput: { updatedInput: value } }));
  const failed = interpretRun('pre-tool-use', 'PreToolUse', { exitCode: 1, stdout: '', failed: true, reason: 'exit 1' });
  assert.deepEqual(mergeOutcomes([update({ a: 1 }), update({ a: 2 }), failed]).updatedInput, { a: 2 });
});

test('merging nothing gives a neutral outcome', () => {
  const merged = mergeOutcomes([]);
  assert.deepEqual([merged.blocked, merged.stopped, merged.permission, merged.contexts], [false, false, undefined, []]);
});
