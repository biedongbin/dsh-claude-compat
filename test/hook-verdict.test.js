// Prompt and agent hook answers (src/hook-verdict.js). Pure functions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVerdict, verdictToRun } from '../src/hook-verdict.js';
import { interpretRun } from '../src/hook-output.js';

// ─── parseVerdict ────────────────────────────────────────────────────────────

test('a bare JSON answer is read', () => {
  assert.deepEqual(parseVerdict('{"ok": true}'), { ok: true, verdict: { ok: true, reason: '', impossible: false } });
  assert.deepEqual(parseVerdict('{"ok": false, "reason": "tests fail"}').verdict, { ok: false, reason: 'tests fail', impossible: false });
});

test('an answer in a code fence, or with text around it, is read', () => {
  assert.equal(parseVerdict('```json\n{"ok": true}\n```').verdict.ok, true);
  assert.equal(parseVerdict('Here is my answer: {"ok": false, "reason": "r"} Done.').verdict.reason, 'r');
  assert.equal(parseVerdict('  \n{"ok":true}\n ').verdict.ok, true);
});

test('impossible is kept only when it is true', () => {
  assert.equal(parseVerdict('{"ok": false, "reason": "r", "impossible": true}').verdict.impossible, true);
  assert.equal(parseVerdict('{"ok": false, "reason": "r", "impossible": "yes"}').verdict.impossible, false);
});

test('an answer that is not valid is an error that says why', () => {
  assert.match(parseVerdict('I think it is fine').error, /not a JSON object/);
  assert.match(parseVerdict('[1,2]').error, /not a JSON object/);
  assert.match(parseVerdict('{"ok": "yes"}').error, /no boolean "ok"/);
  assert.match(parseVerdict('{}').error, /no boolean "ok"/);
  assert.match(parseVerdict('{"ok": false}').error, /no "reason"/);
  assert.match(parseVerdict('{"ok": false, "reason": "  "}').error, /no "reason"/);
  assert.match(parseVerdict('').error, /not a JSON object/);
});

test('ok true needs no reason', () => {
  assert.equal(parseVerdict('{"ok": true}').ok, true);
});

// ─── verdictToRun ────────────────────────────────────────────────────────────

const block = (event, hook = { type: 'prompt' }, extra = {}) => verdictToRun(event, { ok: false, reason: 'because', ...extra }, hook);
const outcomeOf = (event, run) => interpretRun(event, 'X', run);

test('ok true allows on every event', () => {
  for (const event of ['pre-tool-use', 'stop', 'user-prompt-submit', 'teammate-idle']) {
    assert.deepEqual(verdictToRun(event, { ok: true }, { type: 'prompt' }), { exitCode: 0, stdout: '', failed: false });
  }
});

test('ok false blocks the events that block, with the reason', () => {
  for (const event of ['pre-tool-use', 'post-tool-use', 'post-tool-batch', 'user-prompt-submit', 'user-prompt-expansion',
    'task-created', 'task-completed', 'stop', 'subagent-stop']) {
    const outcome = outcomeOf(event, block(event));
    assert.deepEqual([outcome.blocked, outcome.reason], [true, 'because'], event);
  }
});

test('impossible lets a prompt hook end the turn on Stop and SubagentStop, and an agent hook cannot', () => {
  for (const event of ['stop', 'subagent-stop']) {
    assert.equal(outcomeOf(event, block(event, { type: 'prompt' }, { impossible: true })).blocked, false, event);
    assert.equal(outcomeOf(event, block(event, { type: 'agent' }, { impossible: true })).blocked, true, event);
  }
});

test('impossible has no effect on the other events', () => {
  assert.equal(outcomeOf('pre-tool-use', block('pre-tool-use', { type: 'prompt' }, { impossible: true })).blocked, true);
});

test('ok false on PostToolUseFailure goes back to the model as context', () => {
  const outcome = outcomeOf('post-tool-use-failure', block('post-tool-use-failure'));
  assert.deepEqual([outcome.blocked, outcome.contexts], [false, ['because']]);
});

test('ok false has no effect on PermissionDenied', () => {
  const outcome = outcomeOf('permission-denied', block('permission-denied'));
  assert.deepEqual([outcome.blocked, outcome.contexts, outcome.failed], [false, [], false]);
});

test('ok false on PermissionRequest is a deny decision with the reason', () => {
  const outcome = interpretRun('permission-request', 'PermissionRequest', block('permission-request'));
  assert.deepEqual(outcome.specific.decision, { behavior: 'deny', message: 'because' });
});

test('on TeammateIdle only continueOnBlock, or an agent hook, keeps the teammate working', () => {
  assert.equal(outcomeOf('teammate-idle', block('teammate-idle', { type: 'prompt' })).blocked, false);
  assert.equal(outcomeOf('teammate-idle', block('teammate-idle', { type: 'prompt', continueOnBlock: true })).blocked, true);
  assert.equal(outcomeOf('teammate-idle', block('teammate-idle', { type: 'agent' })).blocked, true);
});

test('a block with a reason that holds JSON characters stays text', () => {
  const run = verdictToRun('pre-tool-use', { ok: false, reason: '{"a": 1}' }, { type: 'prompt' });
  assert.equal(outcomeOf('pre-tool-use', run).reason, '{"a": 1}');
});
