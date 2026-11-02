// dsh-claude-compat: TaskCreated and TaskCompleted.
//
// DSH has one todo tool, `todo_write`, that replaces the whole list on each call.
// A task is created when its text is new in the list, and completed when its status
// becomes `completed`. A blocking hook denies the whole call, so the list stays as
// it was. Todo items have no id, so `task_id` is `todo-<position>` in the new list.

const TODO_TOOL = 'todo_write';

function validTodos(exec) {
  const todos = exec.arguments?.todos;
  if (!Array.isArray(todos)) return undefined;
  return todos.filter((todo) => typeof todo?.content === 'string');
}

// Count how many times each text occurs, so a repeated text is matched one to one.
function countByContent(todos) {
  const counts = new Map();
  for (const todo of todos) counts.set(todo.content, (counts.get(todo.content) ?? 0) + 1);
  return counts;
}

/** The todos that are new in `next`, each with its position in `next`. */
export function createdTodos(previous, next) {
  const known = countByContent(previous);
  const created = [];
  next.forEach((todo, index) => {
    const left = known.get(todo.content) ?? 0;
    if (left > 0) known.set(todo.content, left - 1);
    else created.push({ todo, index });
  });
  return created;
}

/** The todos that are `completed` in `next` and were not `completed` before. */
export function completedTodos(previous, next) {
  const done = countByContent(previous.filter((todo) => todo.status === 'completed'));
  const completed = [];
  next.forEach((todo, index) => {
    if (todo.status !== 'completed') return;
    const left = done.get(todo.content) ?? 0;
    if (left > 0) done.set(todo.content, left - 1);
    else completed.push({ todo, index });
  });
  return completed;
}

function taskFields({ todo, index }) {
  return { task_id: `todo-${index + 1}`, task_subject: todo.content, task_description: '' };
}

async function fireTask(engine, support, agent, event, claudeName, entry) {
  const outcome = await engine.fire(event, claudeName, {
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
  const previous = lists.get(exec.agent?.session?.header?.id ?? '') ?? [];
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
  if (todos !== undefined) lists.set(exec.agent?.session?.header?.id ?? '', todos);
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
  ctx.on('tools/pre-execute', (exec, next) => onPreTool(engine, support, lists, exec, next));
  ctx.on('tools/post-execute', (exec, result, next) => onPostTool(lists, exec, result, next));
}
