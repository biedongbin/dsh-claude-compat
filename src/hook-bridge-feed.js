// dsh-claude-compat: hooks that DSH reports only after the fact, on its
// `session/event` feed: CwdChanged, PreCompact, PostCompact and UserPromptExpansion.
//
// The feed fires after DSH commits an event, so these hooks observe. A hook
// cannot block the directory change, the compaction or the command.

import { sessionIdOf } from './hook-support.js';

const COMPACT_DEFAULT_TRIGGER = 'auto';
// The arguments of recent commands, so a compaction can tell which `/compact` started it.
const MAX_REMEMBERED_COMMANDS = 50;

function warnObserveOnly(claudeName, what) {
  console.warn(`dsh-claude-compat: ${claudeName} hook asked to block ${what}; DSH reports it after it happened, ignored`);
}

// The feed gives a session, not an agent. A payload needs only the session.
const asAgent = (session) => ({ session });

async function onCwdChanged(deps, session, data) {
  const { engine, support, cwds } = deps;
  const key = sessionIdOf(asAgent(session));
  const oldCwd = cwds.get(key) ?? session.header?.cwd ?? '';
  cwds.set(key, data.cwd);
  const outcome = await engine.fire('cwd-changed', 'CwdChanged', {
    payload: support.payload('CwdChanged', asAgent(session), { old_cwd: oldCwd, new_cwd: data.cwd }),
  });
  support.files.cwdChanged(session, data.cwd, outcome.watchPathsGiven ? outcome.watchPaths : undefined);
}

async function onCompactionStart(deps, session, data) {
  const { engine, support, commands } = deps;
  const manual = data.sourceCommandId !== undefined;
  const trigger = manual ? 'manual' : COMPACT_DEFAULT_TRIGGER;
  const args = manual ? commands.get(data.sourceCommandId) : undefined;
  const outcome = await engine.fire('pre-compact', 'PreCompact', {
    subject: trigger,
    payload: support.payload('PreCompact', asAgent(session), {
      trigger,
      custom_instructions: args === undefined || args === '' ? null : args,
    }),
  });
  if (outcome.blocked || outcome.stopped) warnObserveOnly('PreCompact', 'compaction');
}

async function onCompactionEnd(deps, session, data) {
  const { engine, support, summaries, commands } = deps;
  const summary = summaries.get(data.compactionId);
  summaries.delete(data.compactionId);
  if (data.error !== undefined) return;
  const trigger = data.sourceCommandId === undefined ? COMPACT_DEFAULT_TRIGGER : 'manual';
  if (data.sourceCommandId !== undefined) commands.delete(data.sourceCommandId);
  await engine.fire('post-compact', 'PostCompact', {
    subject: trigger,
    payload: support.payload('PostCompact', asAgent(session), { trigger, compact_summary: summary ?? '' }),
  });
}

async function onCommandRun(deps, session, data) {
  const { engine, support } = deps;
  const args = data.args ?? '';
  const outcome = await engine.fire('user-prompt-expansion', 'UserPromptExpansion', {
    subject: data.name,
    payload: support.payload('UserPromptExpansion', asAgent(session), {
      expansion_type: 'slash_command',
      command_name: data.name,
      command_args: args,
      command_source: String(data.source ?? ''),
      prompt: `/${data.name}${args === '' ? '' : ` ${args}`}`,
    }),
  });
  if (outcome.blocked || outcome.stopped) warnObserveOnly('UserPromptExpansion', 'the command');
}

function dispatchEvent(deps, session, event) {
  const { engine, commands, summaries } = deps;
  const { type, data } = event;
  if (type === 'working-directory/change' && engine.has('cwd-changed')) return onCwdChanged(deps, session, data);
  if (type === 'command/run') {
    if (data.args !== undefined) {
      if (commands.size >= MAX_REMEMBERED_COMMANDS) commands.delete(commands.keys().next().value);
      commands.set(data.commandId, data.args);
    }
    return engine.has('user-prompt-expansion') ? onCommandRun(deps, session, data) : undefined;
  }
  if (type === 'compaction/start' && engine.has('pre-compact')) return onCompactionStart(deps, session, data);
  if (type === 'compaction/summary') summaries.set(data.compactionId, data.summary);
  if (type === 'compaction/end' && engine.has('post-compact')) return onCompactionEnd(deps, session, data);
  return undefined;
}

/**
 * Register the session-feed hooks that the configured settings use.
 * @param {object} ctx DSH plugin context
 * @param {object} engine hook engine
 * @param {object} support shared helpers
 */
export function registerFeedHooks(ctx, engine, support) {
  const wanted = ['cwd-changed', 'pre-compact', 'post-compact', 'user-prompt-expansion'];
  if (!wanted.some((event) => engine.has(event))) return;
  const deps = { engine, support, cwds: new Map(), commands: new Map(), summaries: new Map() };
  // Events run one after another, so a hook sees them in the order DSH committed them.
  let queue = Promise.resolve();
  ctx.on('session/event', (session, event) => {
    queue = queue.then(() => dispatchEvent(deps, session, event)).catch((error) => {
      console.warn(`dsh-claude-compat: ${event.type} hooks failed: ${error?.message ?? error}`);
    });
    support.track(queue);
  });
}
