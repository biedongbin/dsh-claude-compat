// dsh-claude-compat: PermissionRequest, PermissionDenied and PostToolBatch.
//
// PermissionRequest runs on DSH's `approval/request` waterfall. A hook decision
// answers the request. With no decision the bridge calls `next()`, so the normal
// answerers still run. PostToolBatch runs at the first `agent/pre-step` after a
// group of tool results, which is the point before the next model call.

import { blocksToText } from './hook-support.js';
import { responseOf } from './hook-bridge-tools.js';

// DSH has no event that groups parallel calls. The log of calls whose input an
// approval request may need is bounded, because a call that never finishes
// leaves its entry behind.
const MAX_TRACKED_CALLS = 1000;

function createCallLog() {
  const calls = new Map();
  return {
    record(exec) {
      if (calls.size >= MAX_TRACKED_CALLS) calls.delete(calls.keys().next().value);
      calls.set(exec.callId, { name: exec.name, input: exec.arguments ?? {} });
    },
    get: (callId) => calls.get(callId),
    forget: (callId) => calls.delete(callId),
  };
}

// The `decision` object of a PermissionRequest hook, or undefined for no decision.
// Exit code 2 is not honored on this event (Claude Code docs, "Exit code 2 behavior").
function permissionDecision(outcome) {
  const decision = outcome.specific.decision;
  if (outcome.stopped) return { behavior: 'deny', message: outcome.stopReason };
  if (typeof decision !== 'object' || decision === null) return undefined;
  return decision.behavior === 'allow' || decision.behavior === 'deny' ? decision : undefined;
}

async function onApproval(engine, support, calls, req, next) {
  const call = calls.get(req.callId) ?? { name: req.toolName, input: {} };
  const fields = { tool_name: req.toolName, tool_input: call.input, permission_suggestions: [] };
  const outcome = await engine.fire('permission-request', 'PermissionRequest', {
    subject: req.toolName,
    agent: req.agent,
    rewake: support.rewake(req.agent),
    tool: { name: req.toolName, input: call.input },
    payload: support.payload('PermissionRequest', req.agent, fields),
  });
  const decision = permissionDecision(outcome);
  if (decision?.updatedInput !== undefined) {
    console.warn(`dsh-claude-compat: PermissionRequest hook asked to change the input of ${req.toolName}; DSH tool input cannot be changed, ignored`);
  }
  if (decision?.behavior === 'allow') return 'allowed-once';
  if (decision?.behavior === 'deny') {
    console.warn(`dsh-claude-compat: PermissionRequest hook denied ${req.toolName}${decision.message === undefined ? '' : `: ${decision.message}`}`);
    return 'rejected';
  }
  const answer = await next();
  if (answer === 'rejected') await onDenied(engine, support, req, fields);
  return answer;
}

// A rejected approval is the closest DSH has to the denial that PermissionDenied
// reports. `retry: true` becomes a note to the model, because DSH cannot rerun the call.
async function onDenied(engine, support, req, fields) {
  const outcome = await engine.fire('permission-denied', 'PermissionDenied', {
    subject: req.toolName,
    agent: req.agent,
    rewake: support.rewake(req.agent),
    tool: { name: req.toolName, input: fields.tool_input },
    payload: support.payload('PermissionDenied', req.agent, {
      tool_name: req.toolName,
      tool_input: fields.tool_input,
      tool_use_id: req.callId,
      reason: req.reason ?? 'permission request rejected',
    }),
  });
  support.inject(req.agent, outcome);
  if (outcome.retry) {
    support.inject(req.agent, { contexts: [`The ${req.toolName} call was denied. A hook says you may retry it.`] });
  }
}

function sessionKey(agent) {
  return agent?.session?.header?.id ?? '';
}

function failureText(result) {
  return blocksToText(result.content) || String(result.error?.message ?? result.error?.code ?? 'tool failed');
}

function recordResult(batches, exec, result) {
  const key = sessionKey(exec.agent);
  const entries = batches.get(key) ?? [];
  entries.push({
    tool_name: exec.name,
    tool_input: exec.arguments ?? {},
    tool_use_id: exec.callId,
    tool_response: result.isError === true ? failureText(result) : responseOf(result),
  });
  batches.set(key, entries);
}

async function onPreStep(engine, support, batches, payload, next) {
  const { agent } = payload;
  const toolCalls = batches.get(sessionKey(agent));
  if (toolCalls === undefined || toolCalls.length === 0) return next();
  batches.delete(sessionKey(agent));
  const outcome = await engine.fire('post-tool-batch', 'PostToolBatch', {
    agent,
    rewake: support.rewake(agent),
    payload: support.payload('PostToolBatch', agent, { tool_calls: toolCalls }),
  });
  if (outcome.blocked || outcome.stopped) {
    console.warn(`dsh-claude-compat: PostToolBatch hook stopped the loop: ${outcome.reason ?? outcome.stopReason ?? 'blocked'}`);
    return { kind: 'reject' };
  }
  const downstream = await next();
  const extra = support.contextMessages(outcome);
  if (extra.length === 0 || downstream.kind !== 'enter') return downstream;
  return { ...downstream, messages: [...downstream.messages, ...extra] };
}

/**
 * Register the permission and batch hooks that the configured settings use.
 * @param {object} ctx DSH plugin context
 * @param {object} engine hook engine
 * @param {object} support shared helpers
 */
export function registerPermissionHooks(ctx, engine, support) {
  const wantsApproval = engine.has('permission-request') || engine.has('permission-denied');
  const wantsBatch = engine.has('post-tool-batch');
  const calls = createCallLog();
  const batches = new Map();
  if (wantsApproval) {
    // Record each call's input first, because an approval request carries only the call id.
    ctx.on('tools/pre-execute', (exec, next) => {
      if (!support.isHookCall(exec)) calls.record(exec);
      return next();
    });
    ctx.on('approval/request', (req, next) => onApproval(engine, support, calls, req, next));
  }
  if (wantsApproval || wantsBatch) {
    ctx.on('tools/post-execute', async (exec, result, next) => {
      calls.forget(exec.callId);
      if (wantsBatch && !support.isHookCall(exec)) recordResult(batches, exec, result);
      return next();
    });
  }
  if (wantsBatch) {
    ctx.on('agent/pre-step', (payload, next) => onPreStep(engine, support, batches, payload, next));
  }
}
