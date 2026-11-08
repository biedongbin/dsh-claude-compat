// dsh-claude-compat: helpers for the DSH runtime this plugin loads into.
//
// DSH 0.2.2-rc.1 runs on Cordis 4, where `ctx.<service>` only resolves for a
// service the plugin declared in its `inject` list. Reading any other service as
// a property throws `cannot get property "<name>" without inject` — and it
// throws while the property is read, so `ctx.foo?.bar?.()` cannot guard it.
// The inject-free lookup is `ctx.get(name)`, which returns undefined when the
// service is absent and therefore keeps this plugin's optional dependencies
// optional (see src/index.js: `inject` is only `skills`).

/**
 * Read a service without requiring it in `inject`.
 * Cordis 4 uses `ctx.get(name)`; a host without that API falls back to the
 * property read that older Cordis versions supported.
 * @param {object} ctx DSH plugin context
 * @param {string} name service name
 * @returns {any} the service, or undefined when it is not provided
 */
export function serviceOf(ctx, name) {
  if (ctx === undefined || ctx === null) return undefined;
  try {
    if (typeof ctx.get === 'function') return ctx.get(name);
  } catch {
    // An older host, or a context whose reads throw: try the property read.
  }
  try { return ctx[name]; } catch { return undefined; }
}

/** Same as {@link serviceOf}; the name marks a read that may legitimately be absent. */
export const safeServiceOf = serviceOf;

/**
 * Execute one tool call through the DSH tool executor.
 *
 * DSH 0.2.2-rc.1+ takes a batch (`{ calls, signal, agent }`) and pairs each
 * settlement by callId; earlier releases took a single call (`{ callId, name,
 * arguments, signal, agent }`) and returned the result itself.
 * @param {object} tools the ctx tool service
 * @param {{type: string, id: string, name: string, arguments: string}} call wire-format call
 * @param {{signal?: AbortSignal, agent?: object}} options runner options
 * @returns {Promise<object|undefined>} one tool execution result
 */
export async function executeToolCall(tools, call, options = {}) {
  if (tools === undefined) throw new Error('the DSH tool service is not available');

  let outcome;
  try {
    outcome = await tools.execute({ calls: [call], ...options });
  } catch (error) {
    // Fall back only when the executor rejects the shape; a failing tool is a
    // real result and must never be re-run under the other contract.
    if (!isContractMismatch(error)) throw error;
    return tools.execute({ callId: call.id, name: call.name, arguments: call.arguments, ...options });
  }

  // Batch contract: one settlement per callId.
  if (outcome !== null && typeof outcome === 'object' && Array.isArray(outcome.results)) {
    return outcome.results.find((entry) => entry.callId === call.id)?.result;
  }
  // Single-call contract: the result is the return value.
  return outcome;
}

/** True only for "this executor does not accept a `calls` batch" — nothing else is retried. */
function isContractMismatch(error) {
  if (error === null || typeof error !== 'object') return false;
  if (error.name !== 'TypeError') return false;
  return /\bcalls\b/i.test(String(error.message));
}

/**
 * Resolve BlockAssembler at use time. Releases before 0.2.2 may not export it,
 * and a missing top-level export fails the whole plugin at import time.
 * @returns {Promise<object>} a BlockAssembler instance
 */
export async function createBlockAssembler() {
  const module = await import('@deepseek-ai/dsh-llm');
  const Assembler = module.BlockAssembler;
  if (typeof Assembler !== 'function') {
    throw new Error('this DSH version does not export BlockAssembler; prompt hooks need a newer DSH');
  }
  return new Assembler();
}

/**
 * Resolve the RPC request schema at use time; older releases do not export it.
 * A missing schema is not fatal: the caller keeps the method check and drops
 * only the envelope validation it cannot perform.
 * @returns {Promise<object|undefined>}
 */
export async function loadClientRequestSchema() {
  try {
    const module = await import('@deepseek-ai/dsh-client-connection');
    return module.clientRequestSchema;
  } catch {
    return undefined;
  }
}
