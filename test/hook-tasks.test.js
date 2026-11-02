// TaskCreated and TaskCompleted on DSH's whole-list todo_write tool.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { completedTodos, createdTodos } from '../src/hook-bridge-tasks.js';
import { fakeAgent, harness, say, tempDir } from './hook-kit.js';

const todo = (content, status = 'pending') => ({ content, status });
const write = (agent, todos, callId = 'w') => ({ name: 'todo_write', arguments: { todos }, callId, agent });
const allow = async () => ({ kind: 'allow' });
const accept = async () => ({ kind: 'accept' });
const OK = { isError: false, value: {}, content: [] };

// Run one todo_write call through both waterfalls, as DSH would when the call is allowed.
async function call(h, agent, todos) {
  const decision = await h.dispatch('tools/pre-execute', [write(agent, todos)], allow);
  if (decision.kind === 'allow') await h.dispatch('tools/post-execute', [write(agent, todos), OK], accept);
  return decision;
}

// ─── list differences ────────────────────────────────────────────────────────

test('createdTodos finds new text, with its position in the new list', () => {
  const created = createdTodos([todo('a')], [todo('b'), todo('a'), todo('c')]);
  assert.deepEqual(created.map((entry) => [entry.index, entry.todo.content]), [[0, 'b'], [2, 'c']]);
});

test('createdTodos matches repeated text one to one', () => {
  assert.equal(createdTodos([todo('a')], [todo('a'), todo('a')]).length, 1);
  assert.equal(createdTodos([todo('a'), todo('a')], [todo('a')]).length, 0);
});

test('completedTodos finds a status change to completed, and a task created already completed', () => {
  const before = [todo('a', 'in_progress'), todo('b', 'completed')];
  const after = [todo('a', 'completed'), todo('b', 'completed'), todo('c', 'completed')];
  assert.deepEqual(completedTodos(before, after).map((entry) => entry.todo.content), ['a', 'c']);
});

test('completedTodos ignores a task that was already completed', () => {
  assert.deepEqual(completedTodos([todo('a', 'completed')], [todo('a', 'completed')]), []);
});

// ─── hooks ───────────────────────────────────────────────────────────────────

test('TaskCreated runs for each new todo, with task_id by position and the text as subject', async () => {
  const file = join(tempDir('dcc-task-'), 'lines');
  const h = harness({ TaskCreated: [{ hooks: [{ command: `cat | tr -d '\\n' >> "${file}"; echo >> "${file}"` }] }] });
  const agent = fakeAgent('s4');
  await call(h, agent, [todo('write tests'), todo('ship')]);
  const lines = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((line) => [line.hook_event_name, line.task_id, line.task_subject, line.session_id]), [
    ['TaskCreated', 'todo-1', 'write tests', 's4'],
    ['TaskCreated', 'todo-2', 'ship', 's4'],
  ]);
});

test('TaskCreated does not run again for a todo that the previous call already had', async () => {
  const file = join(tempDir('dcc-task-'), 'runs');
  const h = harness({ TaskCreated: [{ hooks: [{ command: `echo run >> "${file}"` }] }] });
  const agent = fakeAgent();
  await call(h, agent, [todo('a')]);
  await call(h, agent, [todo('a', 'in_progress'), todo('b')]);
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 2);
});

test('TaskCreated: exit 2 denies the whole call with the hook reason, and the list does not change', async () => {
  const file = join(tempDir('dcc-task-'), 'runs');
  const h = harness({ TaskCreated: [{ hooks: [{ command: `echo run >> "${file}"; echo too vague >&2; exit 2` }] }] });
  const agent = fakeAgent();
  assert.deepEqual(await call(h, agent, [todo('x')]), { kind: 'deny', reason: 'too vague' });
  await call(h, agent, [todo('x')]);
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').filter((line) => line === 'run').length, 2, 'x is still new');
});

test('TaskCompleted runs when a todo becomes completed, and exit 2 denies the call', async () => {
  const h = harness({ TaskCompleted: [{ hooks: [{ command: 'echo not done >&2; exit 2' }] }] });
  const agent = fakeAgent();
  assert.equal((await call(h, agent, [todo('a')])).kind, 'allow', 'creating a pending task is not a completion');
  assert.deepEqual(await call(h, agent, [todo('a', 'completed')]), { kind: 'deny', reason: 'not done' });
});

test('a task hook decision of block also denies', async () => {
  const h = harness({ TaskCreated: [{ hooks: [{ command: say({ decision: 'block', reason: 'no' }) }] }] });
  assert.deepEqual(await call(h, fakeAgent(), [todo('a')]), { kind: 'deny', reason: 'no' });
});

test('a task hook that fails without onFailure does not deny', async () => {
  const h = harness({ TaskCreated: [{ hooks: [{ command: 'exit 5' }] }] });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal((await call(h, fakeAgent(), [todo('a')])).kind, 'allow');
  } finally {
    console.warn = originalWarn;
  }
});

test('other tools and malformed todo_write arguments pass through', async () => {
  const file = join(tempDir('dcc-task-'), 'ran');
  const h = harness({ TaskCreated: [{ hooks: [{ command: `echo ran >> "${file}"` }] }] });
  const agent = fakeAgent();
  await h.dispatch('tools/pre-execute', [{ name: 'Bash', arguments: { todos: [todo('a')] }, callId: 'b', agent }], allow);
  await h.dispatch('tools/pre-execute', [{ name: 'todo_write', arguments: { todos: 'nope' }, callId: 'c', agent }], allow);
  await h.dispatch('tools/pre-execute', [{ name: 'todo_write', arguments: undefined, callId: 'd', agent }], allow);
  assert.throws(() => readFileSync(file), /ENOENT/);
});

test('a failed todo_write does not become the baseline', async () => {
  const file = join(tempDir('dcc-task-'), 'runs');
  const h = harness({ TaskCreated: [{ hooks: [{ command: `echo run >> "${file}"` }] }] });
  const agent = fakeAgent();
  await h.dispatch('tools/pre-execute', [write(agent, [todo('a')])], allow);
  await h.dispatch('tools/post-execute', [write(agent, [todo('a')]), { isError: true, error: {}, content: [] }], accept);
  await call(h, agent, [todo('a')]);
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 2, 'a is still new after the failed write');
});

test('each session keeps its own baseline', async () => {
  const file = join(tempDir('dcc-task-'), 'runs');
  const h = harness({ TaskCreated: [{ hooks: [{ command: `echo run >> "${file}"` }] }] });
  await call(h, fakeAgent('one'), [todo('a')]);
  await call(h, fakeAgent('two'), [todo('a')]);
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 2);
});
