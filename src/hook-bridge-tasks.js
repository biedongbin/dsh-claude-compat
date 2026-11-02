// dsh-claude-compat: TaskCreated and TaskCompleted.
//
// DSH has one todo tool, `todo_write`, that replaces the whole list on each call.
// A task is created when its text is new in the list, and completed when its status
// becomes `completed`. A blocking hook denies the whole call, so the list stays as
// it was. Todo items have no id, so `task_id` is `todo-<position>` in the new list.

import { sessionIdOf } from './hook-support.js';

const TODO_TOOL = 'todo_write';

function validTodos(exec) {
  const todos = exec.arguments?.todos;
  if (!Array.isArray(todos)) {
    console.warn('dsh-claude-compat: todo_write arguments have no todos list; TaskCreated and TaskCompleted hooks skipped');
    return undefined;
  }
  return todos.filter((todo) => typeof todo?.content === 'string');
}

// Count how many times each text occurs, so a repeated text is matched one to one.
function countByContent(todos) {
  const counts = new Map();
  for (const todo of todos) counts.set(todo.content, (counts.get(todo.content) ?? 0) + 1);
  return counts;
}

// The entries of `next` (with their position) that `before` does not account for, one to one.
function unmatched(before, next, keep) {
  const known = countByContent(before);
  const result = [];
  next.forEach((todo, index) => {
    if (!keep(todo)) return;
    const left = known.get(todo.content) ?? 0;
    if (left > 0) known.set(todo.content, left - 1);
    else result.push({ todo, index });
  });
  return result;
}

/** The todos that are new in `next`, each with its position in `next`. */
export function createdTodos(previous, next) {
  return unmatched(previous, next, () => true);
}

/** The todos that are `completed` in `next` and were not `completed` before. */
export function completedTodos(previous, next) {
  return unmatched(previous.filter((todo) => todo.status === 'completed'), next, (todo) => todo.status === 'completed');
}

function taskFields({ todo, index }) {
  return { task_id: `todo-${index + 1}`, task_subject: todo.content, task_description: '' };
}

async function fireTask(engine, support, agent, event, claudeName, entry) {
  const outcome = await engine.fire(event, claudeName, {
    agent,
    rewake: support.rewake(agent),
    payload: support.payload(claudeName, agent, taskFields(entry)),
  });
  support.inject(agent, outcome);
  if (!outcome.blocked && !outcome.stopped) return undefined;
  const reason = outcome.reason ?? outcome.stopReason ?? `blocked by ${claudeName} hook`;
  return { kind: 'deny', reason };
}

async function onPreTool(engine, support, lists, exec, next) {
  const todos = exec.name === TODO_TOOL ? validTodos(exec) : undefined;
  if (todos === undefined) return next();
  const previous = lists.get(sessionIdOf(exec.agent)) ?? [];
  const steps = [
    ['task-created', 'TaskCreated', createdTodos(previous, todos)],
    ['task-completed', 'TaskCompleted', completedTodos(previous, todos)],
  ];
  for (const [event, claudeName, entries] of steps) {
    if (!engine.has(event)) continue;
    for (const entry of entries) {
      const denial = await fireTask(engine, support, exec.agent, event, claudeName, entry);
      if (denial !== undefined) return denial;
    }
  }
  return next();
}

// The list that DSH accepted is the baseline for the next call.
async function onPostTool(lists, exec, result, next) {
  const todos = exec.name === TODO_TOOL && result.isError !== true ? validTodos(exec) : undefined;
  if (todos !== undefined) lists.set(sessionIdOf(exec.agent), todos);
  return next();
}

/**
 * Register the task hooks that the configured settings use.
 * @param {object} ctx DSH plugin context
 * @param {object} engine hook engine
 * @param {object} support shared helpers
 */
export function registerTaskHooks(ctx, engine, support) {
  if (!engine.has('task-created') && !engine.has('task-completed')) return;
  const lists = new Map();
  support.onForget((id) => lists.delete(id));
  ctx.on('tools/pre-execute', (exec, next) => onPreTool(engine, support, lists, exec, next));
  ctx.on('tools/post-execute', (exec, result, next) => onPostTool(lists, exec, result, next));
}
