// dsh-claude-compat: session lifecycle hooks: SessionStart, SessionEnd and
// UserPromptSubmit.
//
// SessionStart runs on `agent/created`, the DSH point that announces a new agent
// with its start source (startup, resume, clear, compact).

import { blocksToText } from './hook-support.js';

// Claude Code lowers the default timeout of these events (docs, "Common handler fields").
const PROMPT_DEFAULT_MS = 30_000;
const SESSION_END_DEFAULT_MS = 1_500;

async function onAgentCreated(engine, support, { agent, source }) {
  try {
    const outcome = await engine.fire('session-start', 'SessionStart', {
      subject: source,
      payload: support.payload('SessionStart', agent, { source }),
    });
    support.inject(agent, outcome);
  } catch (error) {
    console.warn(`dsh-claude-compat: SessionStart hooks failed: ${error?.message ?? error}`);
  }
}

// SessionEnd runs after the agent is gone, so it cannot delay shutdown. The run
// is tracked, and plugin disposal waits for it.
function onAgentDisposed(engine, support, { agent }) {
  support.track(engine.fire('session-end', 'SessionEnd', {
    subject: 'other',
    defaultMs: SESSION_END_DEFAULT_MS,
    payload: support.payload('SessionEnd', agent, { reason: 'other' }),
  }));
}

// A step that carries user messages is a prompt. A blocking hook rejects the
// step. The hook's context follows the user's messages.
async function onPreStep(engine, support, { agent, messages }, next) {
  if (messages.length === 0) return next();
  const prompt = blocksToText(messages.flatMap((message) => message.content));
  const outcome = await engine.fire('user-prompt-submit', 'UserPromptSubmit', {
    defaultMs: PROMPT_DEFAULT_MS,
    payload: support.payload('UserPromptSubmit', agent, { prompt }),
  });
  if (outcome.blocked || outcome.stopped) {
    console.warn(`dsh-claude-compat: UserPromptSubmit hook blocked the prompt: ${outcome.reason ?? outcome.stopReason ?? 'blocked'}`);
    return { kind: 'reject' };
  }
  const downstream = await next();
  const extra = support.contextMessages(outcome);
  if (extra.length === 0 || downstream.kind !== 'enter') return downstream;
  return { ...downstream, messages: [...downstream.messages, ...extra] };
}

/**
 * Register the lifecycle hooks that the configured settings use.
 * @param {object} ctx DSH plugin context
 * @param {object} engine hook engine
 * @param {object} support shared helpers
 */
export function registerSessionHooks(ctx, engine, support) {
  if (engine.has('session-start')) {
    ctx.on('agent/created', (payload) => onAgentCreated(engine, support, payload));
  }
  if (engine.has('session-end')) {
    ctx.on('agent/disposed', (payload) => onAgentDisposed(engine, support, payload));
  }
  if (engine.has('user-prompt-submit')) {
    ctx.on('agent/pre-step', (payload, next) => onPreStep(engine, support, payload, next));
  }
}
