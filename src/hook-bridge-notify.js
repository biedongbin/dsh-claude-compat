// dsh-claude-compat: Notification hooks for the three notice types that DSH can
// observe: permission_prompt, agent_needs_input and idle_prompt. The other types
// (auth_success, the elicitation types, and so on) have no DSH source.
//
// A Notification hook cannot change anything, so the bridge never delays the
// DSH event that triggers it.

import { isSubagent } from './hook-support.js';

function sessionKey(agent) {
  return agent?.session?.header?.id ?? '';
}

function notify(engine, support, agent, type, title, message) {
  support.track(engine.fire('notification', 'Notification', {
    subject: type,
    payload: support.payload('Notification', agent, { message, title, notification_type: type }),
  }));
}

/**
 * Register the notification hooks that the configured settings use.
 * @param {object} ctx DSH plugin context
 * @param {object} engine hook engine
 * @param {object} support shared helpers
 */
export function registerNotificationHooks(ctx, engine, support) {
  if (!engine.has('notification')) return;
  const running = new Set();
  ctx.on('approval/request', (req, next) => {
    notify(engine, support, req.agent, 'permission_prompt', 'Permission needed', `Permission needed to use ${req.toolName}`);
    return next();
  });
  ctx.on('user-questions/request', (request, next) => {
    notify(engine, support, request.agent, 'agent_needs_input', 'Input needed', 'The agent has a question for you');
    return next();
  });
  // `idle_prompt` means the agent finished a run and waits for the next prompt. The
  // first `idle` of a new agent is not a finished run.
  ctx.on('agent/status', ({ agent, status }) => {
    if (isSubagent(agent)) return;
    const key = sessionKey(agent);
    if (status === 'running') {
      running.add(key);
    } else if (running.delete(key)) {
      notify(engine, support, agent, 'idle_prompt', 'Waiting for input', 'The agent is waiting for your input');
    }
  });
}
