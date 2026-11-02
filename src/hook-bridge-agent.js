// dsh-claude-compat: Stop, StopFailure, SubagentStart and SubagentStop.
//
// Stop runs on `agent/turn-stopping`. A hook that blocks makes the agent continue:
// the bridge steers the agent with the reason, as Claude Code does. SubagentStop
// runs after the subagent ended, so it cannot keep the subagent running.

import { SUBAGENT_TYPE, blocksToText, isSubagent, sessionIdOf } from './hook-support.js';

const DEFAULT_STOP_CAP = 8;

/** Consecutive Stop continuations allowed (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`, default 8). */
export function stopCap(env = process.env) {
  const cap = Number(env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP);
  return Number.isInteger(cap) && cap > 0 ? cap : DEFAULT_STOP_CAP;
}

// Claude Code error types, from the failure codes of the DSH LLM layer.
const ERROR_TYPES = {
  AUTH: 'authentication_failed',
  QUOTA: 'billing_error',
  RATE_LIMIT: 'rate_limit',
  INVALID_REQUEST: 'invalid_request',
  CONTEXT_WINDOW_EXCEEDED: 'invalid_request',
  SERVER: 'server_error',
  HTTP_404: 'model_not_found',
};

/**
 * The StopFailure `error` type for a DSH model-request error.
 * @param {unknown} error an `LlmError`, or any value
 * @returns {string} a Claude Code error type, `unknown` when none fits
 */
export function classifyError(error) {
  if (error?.failure?.status === 529) return 'overloaded';
  return ERROR_TYPES[error?.code] ?? 'unknown';
}

// What Stop asks for: the text to continue with, or undefined to let the turn end.
// `continue: false` ends the turn and wins over a block.
function stopFeedback(outcome) {
  if (outcome.stopped) return undefined;
  if (outcome.blocked) return outcome.reason ?? 'blocked by Stop hook';
  return outcome.contexts.length > 0 ? outcome.contexts.join('\n\n') : undefined;
}

async function onTurnStopping(deps, { agent }) {
  const { engine, support, messages, continued } = deps;
  if (isSubagent(agent)) return;
  const key = sessionIdOf(agent);
  const count = continued.get(key) ?? 0;
  const outcome = await engine.fire('stop', 'Stop', {
    agent,
    rewake: support.rewake(agent),
    payload: support.payload('Stop', agent, {
      stop_hook_active: count > 0,
      last_assistant_message: messages.lastMessage(agent),
      background_tasks: [],
      session_crons: [],
    }),
  });
  const feedback = stopFeedback(outcome);
  if (feedback === undefined) {
    continued.delete(key);
    return;
  }
  if (count >= stopCap()) {
    console.warn(`dsh-claude-compat: Stop hooks continued the turn ${count} times in a row; ending the turn (CLAUDE_CODE_STOP_HOOK_BLOCK_CAP)`);
    continued.delete(key);
    return;
  }
  continued.set(key, count + 1);
  if (typeof agent.steer === 'function') agent.steer(support.contextMessage(feedback));
}

// Only a failed model request is an API error. Other errors of the loop are not.
function onStopFailure({ engine, support }, { agent, error }) {
  if (error?.name !== 'LlmError' || isSubagent(agent)) return;
  const type = classifyError(error);
  support.track(engine.fire('stop-failure', 'StopFailure', {
    subject: type,
    payload: support.payload('StopFailure', agent, {
      error: type,
      error_details: error.message,
      last_assistant_message: error.message,
    }),
  }));
}

// The child agent of a run. When DSH cannot give it, the hook still runs, but it has no agent
// to add context to.
function subagentChild(ctx, info) {
  const child = typeof ctx.get === 'function' ? ctx.get('agents')?.get?.(info.id) : undefined;
  if (child === undefined) console.warn(`dsh-claude-compat: subagent ${info.id} is not in the agent registry; its hook context is dropped`);
  return child;
}

async function onSubagentStart({ ctx, engine, support }, info) {
  if (support.hookAgents.has(info.id)) return;
  const child = subagentChild(ctx, info);
  const outcome = await engine.fire('subagent-start', 'SubagentStart', {
    subject: SUBAGENT_TYPE,
    agent: child,
    rewake: support.rewake(child),
    payload: support.payload('SubagentStart', child, { agent_id: info.id, agent_type: SUBAGENT_TYPE }),
  });
  support.inject(child, outcome);
}

async function onSubagentEnd({ ctx, engine, support }, info) {
  if (support.hookAgents.has(info.id)) return;
  const child = subagentChild(ctx, info);
  const outcome = await engine.fire('subagent-stop', 'SubagentStop', {
    subject: SUBAGENT_TYPE,
    agent: child,
    payload: support.payload('SubagentStop', child, {
      stop_hook_active: false,
      agent_id: info.id,
      agent_type: SUBAGENT_TYPE,
      agent_transcript_path: '',
      last_assistant_message: blocksToText(info.lastAssistantMessage),
      background_tasks: [],
      session_crons: [],
    }),
  });
  if (outcome.blocked || outcome.contexts.length > 0) {
    console.warn(`dsh-claude-compat: SubagentStop hook asked to keep subagent ${info.id} running; the subagent already ended, ignored`);
  }
}

/**
 * Register the agent lifecycle hooks that the configured settings use.
 * @param {object} ctx DSH plugin context
 * @param {object} engine hook engine
 * @param {object} support shared helpers
 * @param {{lastMessage: (agent: object) => string}} messages reader from registerMessageHooks
 */
export function registerAgentHooks(ctx, engine, support, messages) {
  const deps = { ctx, engine, support, messages, continued: new Map() };
  support.onForget((id) => deps.continued.delete(id));
  if (engine.has('stop')) {
    ctx.on('agent/turn-stopping', (payload) => onTurnStopping(deps, payload));
    // The count of consecutive continuations starts again at each tool call.
    ctx.on('tools/pre-execute', (exec, next) => {
      deps.continued.delete(sessionIdOf(exec.agent));
      return next();
    });
  }
  if (engine.has('stop-failure')) ctx.on('agent/error', (payload) => onStopFailure(deps, payload));
  if (engine.has('subagent-start')) {
    ctx.on('subagent/start', (info) => support.track(onSubagentStart(deps, info)));
  }
  if (engine.has('subagent-stop')) {
    ctx.on('subagent/end', (info) => support.track(onSubagentEnd(deps, info)));
  }
}
