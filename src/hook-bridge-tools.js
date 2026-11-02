// dsh-claude-compat: tool hooks on DSH's tools/pre-execute and tools/post-execute
// waterfalls: PreToolUse, PostToolUse, PostToolUseFailure.
//
// Both waterfalls delegate to `next()` when the hooks have no objection, so
// later DSH listeners (permission policy, spill, guards) still run.

import { blocksToText } from './hook-support.js';

const TOOL_ABORT_CODES = new Set(['ABORTED', 'ABORTED_BEFORE_DISPATCH']);

// Deny when any hook blocks, denies, or stops the run. `defer` only applies to a
// single call in a non-interactive run, so it is treated as no objection.
function preToolDecision(outcome) {
  if (outcome.blocked || outcome.permission === 'deny' || outcome.stopped) {
    const reason = outcome.reason ?? outcome.permissionReason ?? outcome.stopReason;
    return { kind: 'deny', reason: reason ?? 'blocked by PreToolUse hook' };
  }
  if (outcome.permission === 'ask') {
    return { kind: 'ask', ...outcome.permissionReason === undefined ? {} : { reason: outcome.permissionReason } };
  }
  return undefined;
}

async function onPreTool(engine, support, exec, next) {
  const outcome = await engine.fire('pre-tool-use', 'PreToolUse', {
    subject: exec.name,
    tool: { name: exec.name, input: exec.arguments },
    payload: support.payload('PreToolUse', exec.agent, {
      tool_name: exec.name,
      tool_input: exec.arguments ?? {},
      tool_use_id: exec.callId,
    }),
  });
  if (outcome.updatedInput !== undefined) {
    console.warn(`dsh-claude-compat: PreToolUse hook asked to change the input of ${exec.name}; DSH tool input cannot be changed, ignored`);
  }
  support.inject(exec.agent, outcome);
  return preToolDecision(outcome) ?? next();
}

// The tool's value when it has one, else its text.
function responseOf(result) {
  return result.value !== undefined ? result.value : blocksToText(result.content);
}

function failureFields(result) {
  return {
    error: blocksToText(result.content) || String(result.error?.message ?? result.error?.code ?? 'tool failed'),
    is_interrupt: TOOL_ABORT_CODES.has(result.error?.code),
  };
}

// `updatedToolOutput` replaces the result: text becomes content, anything else
// becomes the tool's value.
function replacement(outcome, contexts) {
  const base = { kind: 'accept', ...contexts.length > 0 ? { additionalContexts: contexts } : {} };
  const output = outcome.updatedToolOutput;
  return typeof output === 'string'
    ? { ...base, content: [{ type: 'text', text: output }] }
    : { ...base, value: output };
}

async function onPostTool(engine, support, exec, result, next) {
  const failed = result.isError === true;
  const event = failed ? 'post-tool-use-failure' : 'post-tool-use';
  if (!engine.has(event)) return next();
  const claudeName = failed ? 'PostToolUseFailure' : 'PostToolUse';
  const outcome = await engine.fire(event, claudeName, {
    subject: exec.name,
    tool: { name: exec.name, input: exec.arguments },
    payload: support.payload(claudeName, exec.agent, {
      tool_name: exec.name,
      tool_input: exec.arguments ?? {},
      tool_use_id: exec.callId,
      ...failed ? failureFields(result) : { tool_response: responseOf(result) },
    }),
  });
  const contexts = support.contextMessages(outcome);
  if (!failed && outcome.blocked) {
    return {
      kind: 'block',
      feedback: [{ type: 'text', text: outcome.reason ?? 'blocked by PostToolUse hook' }],
      ...contexts.length > 0 ? { additionalContexts: contexts } : {},
    };
  }
  if (!failed && outcome.updatedToolOutput !== undefined) return replacement(outcome, contexts);
  const downstream = await next();
  if (contexts.length === 0) return downstream;
  return { ...downstream, additionalContexts: [...contexts, ...downstream.additionalContexts ?? []] };
}

/**
 * Register the tool hooks that the configured settings use.
 * @param {object} ctx DSH plugin context
 * @param {object} engine hook engine
 * @param {object} support shared helpers
 */
export function registerToolHooks(ctx, engine, support) {
  if (engine.has('pre-tool-use')) {
    ctx.on('tools/pre-execute', (exec, next) => onPreTool(engine, support, exec, next));
  }
  if (engine.has('post-tool-use') || engine.has('post-tool-use-failure')) {
    ctx.on('tools/post-execute', (exec, result, next) => onPostTool(engine, support, exec, result, next));
  }
}
