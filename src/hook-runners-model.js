// dsh-claude-compat: runners for the handler types that need DSH: mcp_tool, prompt
// and agent. Each one resolves with { exitCode, stdout, failed, reason } and never
// rejects, like the runners in src/hook-handlers.js.
//
// - mcp_tool calls a tool that an MCP server registered with DSH.
// - prompt asks the session's model one question, with no tools.
// - agent starts a DSH subagent that may use tools, and reads its structured answer.

import { createHash, randomUUID } from 'node:crypto';
import { BlockAssembler } from '@deepseek-ai/dsh-llm';
import { failedRun } from './hook-handlers.js';
import { HOOK_CALL_PREFIX, blocksToText } from './hook-support.js';
import { parseVerdict, verdictToRun } from './hook-verdict.js';

// ----- mcp_tool ---------------------------------------------------------------

// The model-facing name of an MCP tool. This is the rule of dsh-mcp-client
// (`publicToolName`): the server name keeps `[A-Za-z0-9_-]` and 32 characters, the full name
// keeps 64, and a changed name gets a hash so two tools never share a name.
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g;
const MAX_PUBLIC_NAME_LENGTH = 64;
const HASH_LENGTH = 12;

/**
 * The DSH tool name for a tool of an MCP server.
 * @param {string} server server name as written in the hook
 * @param {string} tool the server's own tool name
 * @returns {string}
 */
export function mcpToolName(server, tool) {
  const serverName = server.replace(INVALID_NAME_CHARS, '_').slice(0, 32);
  const joined = `mcp__${serverName}__${tool}`;
  const normalized = joined.replace(INVALID_NAME_CHARS, '_');
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized;
  const hash = createHash('sha256').update(`${serverName}\0${tool}`).digest('hex').slice(0, HASH_LENGTH);
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`;
}

const PLACEHOLDER = /\$\{([^}]*)\}/g;

function lookup(input, path) {
  let value = input;
  for (const key of path.trim().split('.')) {
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

/**
 * Replace `${path}` in every string of `value` with the field of the hook input at that path.
 * A text field is used as is, another value as JSON, and a missing field as an empty string.
 * @param {unknown} value the `input` of an mcp_tool hook
 * @param {object} input the hook input
 * @param {string[]} [missing] receives the path of each placeholder that matched no field
 * @returns {unknown}
 */
export function substitute(value, input, missing = []) {
  if (typeof value === 'string') {
    return value.replace(PLACEHOLDER, (_match, path) => {
      const found = lookup(input, path);
      if (found === undefined || found === null) {
        missing.push(path.trim());
        return '';
      }
      return typeof found === 'string' ? found : JSON.stringify(found);
    });
  }
  if (Array.isArray(value)) return value.map((item) => substitute(item, input, missing));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, input, missing)]));
  }
  return value;
}

function abortReason(error, timeoutMs) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError'
    ? `timed out after ${timeoutMs}ms`
    : (error?.message ?? String(error));
}

// ToolRuntime.get(name, scope) sees global tools, and the tools of the scope it is given.
// A tool that an agent connected for itself is invisible without that agent.
async function runMcpToolHook(ctx, support, hook, payload, { timeoutMs, agent }) {
  const name = mcpToolName(hook.server, hook.tool);
  const scope = agent?.session === undefined ? undefined : agent;
  if (ctx.tools?.get?.(name, scope) === undefined) {
    return failedRun(`MCP tool ${name} is not available: the server is not configured, or still connecting`);
  }
  const callId = `${HOOK_CALL_PREFIX}${randomUUID()}`;
  const abort = new AbortController();
  const guard = timeoutGuard(timeoutMs, abort);
  support.hookCalls?.add(callId);
  try {
    const missing = [];
    const input = substitute(hook.input ?? {}, JSON.parse(payload), missing);
    if (missing.length > 0) {
      console.warn(`dsh-claude-compat: mcp_tool hook ${name}: no field of the hook input at ${missing.map((path) => `\${${path}}`).join(', ')}; sent as empty text`);
    }
    // DSH 0.2.2 executes a batch of wire calls and pairs each settlement by callId.
    // The timeout also bounds an executor that does not honor cancellation.
    const batch = await Promise.race([
      ctx.tools.execute({
        calls: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify(input) }],
        signal: abort.signal,
        ...scope === undefined ? {} : { agent: scope },
      }),
      guard.promise,
    ]);
    const result = batch.results.find((entry) => entry.callId === callId)?.result;
    if (!result) return failedRun(`MCP tool ${name}: the executor returned no result for this call`);
    const text = blocksToText(result.content);
    if (result.isError) return failedRun(`MCP tool ${name} failed: ${text}`);
    return { exitCode: 0, stdout: text, failed: false };
  } catch (error) {
    return failedRun(`MCP tool ${name}: ${abortReason(error, timeoutMs)}`);
  } finally {
    clearTimeout(guard.timer);
    support.hookCalls?.delete(callId);
  }
}

// ----- prompt -----------------------------------------------------------------

const PROMPT_SYSTEM = 'You check an action for a hook. Answer with one JSON object and nothing else: '
  + '{"ok": true} to allow, or {"ok": false, "reason": "why"} to block.';
const IMPOSSIBLE_NOTE = ' When the condition can never be met, add "impossible": true to a block.';
const PROMPT_MAX_TOKENS = 1024;

/**
 * The text to send: the hook prompt with `$ARGUMENTS` replaced by the hook input, or the
 * input after the prompt when there is no `$ARGUMENTS`.
 * @param {string} prompt the `prompt` of the hook
 * @param {string} payload JSON text of the hook input
 * @returns {string}
 */
export function buildPrompt(prompt, payload) {
  return prompt.includes('$ARGUMENTS')
    ? prompt.replaceAll('$ARGUMENTS', () => payload)
    : `${prompt}\n\n${payload}`;
}

// The model for a prompt hook: `provider/model` from the hook, else the model of the session.
function modelTarget(agent, model) {
  const latest = agent?.session?.requestHeader?.()?.config;
  const options = agent?.options;
  const base = [latest, options].find((entry) => entry?.provider && entry?.model);
  if (model === undefined) return base;
  const slash = model.indexOf('/');
  if (slash > 0) return { provider: model.slice(0, slash), model: model.slice(slash + 1) };
  return base === undefined ? undefined : { provider: base.provider, model };
}

async function runPromptHook(ctx, hook, payload, { timeoutMs, event, agent }) {
  const target = modelTarget(agent, hook.model);
  if (target === undefined) return failedRun('no model is known for this prompt hook; set "model" as provider/model');
  if (typeof ctx.llm?.stream !== 'function') return failedRun('the DSH model service is not available');
  const abort = new AbortController();
  const guard = timeoutGuard(timeoutMs, abort);
  try {
    const assembler = new BlockAssembler();
    const wantsImpossible = event === 'stop' || event === 'subagent-stop';
    const consume = (async () => {
      for await (const chunk of ctx.llm.stream({
        provider: target.provider,
        model: target.model,
        system: PROMPT_SYSTEM + (wantsImpossible ? IMPOSSIBLE_NOTE : ''),
        messages: [{ role: 'user', content: [{ type: 'text', text: buildPrompt(hook.prompt, payload) }] }],
        maxTokens: PROMPT_MAX_TOKENS,
        temperature: 0,
        signal: abort.signal,
      })) assembler.push(chunk);
    })();
    consume.catch(() => {});
    // An adapter that ignores the signal must not hold the DSH event, so the guard ends the wait.
    await Promise.race([consume, guard.promise]);
    const { finish } = assembler;
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      return failedRun(`model call ${finish.kind === 'aborted' ? 'was cancelled or timed out' : 'failed'}: ${finish.failure?.message ?? finish.kind}`);
    }
    const parsed = parseVerdict(blocksToText(assembler.blocks()));
    return parsed.ok ? verdictToRun(event, parsed.verdict, hook) : failedRun(`prompt hook answer: ${parsed.error}`);
  } catch (error) {
    return failedRun(`prompt hook: ${abortReason(error, timeoutMs)}`);
  } finally {
    clearTimeout(guard.timer);
  }
}

// ----- agent ------------------------------------------------------------------

// DSH's in-process subagent provider. creation-recommendations starts children through it.
const SUBAGENT_PROVIDER = 'spawn';
const VERDICT_SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['ok'],
  additionalProperties: false,
};
const AGENT_INSTRUCTION = '\n\nYou verify a condition for a hook. Investigate with tools that only read. '
  + 'Do not change any file. Finish by returning ok, and a reason when ok is false.';

// The hook's own deadline has passed or been cleared when the cleanup runs, so a subagent that
// does not stop must not hold the DSH event.
const DISPOSE_LIMIT_MS = 5000;

// Stop the verifier subagent. A slow stop is not waited for. The child stays muted until it ends.
async function disposeVerifier(activation, late) {
  const disposing = activation.dispose().catch((error) => {
    console.warn(`dsh-claude-compat: agent hook cleanup failed: ${error?.message ?? error}`);
  });
  let timer;
  const limit = new Promise((resolve) => { timer = setTimeout(() => resolve('slow'), DISPOSE_LIMIT_MS); });
  const done = await Promise.race([disposing.then(() => 'done'), limit]);
  clearTimeout(timer);
  if (done === 'slow') {
    console.warn(`dsh-claude-compat: agent hook cleanup took more than ${DISPOSE_LIMIT_MS}ms; not waiting for it`);
    late.pending = true;
    disposing.finally(late.release);
  }
}

async function finishActivation(activation, timeout, late) {
  try {
    return await Promise.race([activation.result, timeout.promise]);
  } finally {
    clearTimeout(timeout.timer);
    await disposeVerifier(activation, late);
  }
}

function timeoutGuard(timeoutMs, abort) {
  const guard = {};
  guard.promise = new Promise((_resolve, reject) => {
    guard.timer = setTimeout(() => {
      abort.abort();
      reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    }, timeoutMs);
  });
  guard.promise.catch(() => {});
  return guard;
}

// Start the subagent. When the timeout wins, a late start is still stopped. `late.release` runs
// when that has finished, so the child stays muted until it is gone.
async function startVerifier(ctx, spec, timeout, late) {
  const starting = ctx.subagents.startActivation(spec);
  try {
    return await Promise.race([starting, timeout.promise]);
  } catch (error) {
    // A start that failed has nothing to stop. Only a start that the timeout cut off may finish later.
    if (error?.name !== 'TimeoutError') throw error;
    late.pending = true;
    starting
      .then((activation) => activation.dispose())
      .catch((failure) => console.warn(`dsh-claude-compat: agent hook cleanup failed: ${failure?.message ?? failure}`))
      .finally(late.release);
    throw error;
  }
}

function agentVerdict(result) {
  if (result.stopReason !== 'completed') return { error: `the subagent ended with ${result.stopReason}` };
  const source = result.structured === undefined ? blocksToText(result.output) : JSON.stringify(result.structured);
  const parsed = parseVerdict(source);
  return parsed.ok ? { verdict: parsed.verdict } : { error: parsed.error };
}

async function runAgentHook(ctx, support, hook, payload, { timeoutMs, event, agent }) {
  if (typeof agent?.inject !== 'function') return failedRun('an agent hook needs a running agent, and this event has none');
  if (ctx.subagents?.getProvider?.(SUBAGENT_PROVIDER) === undefined) {
    return failedRun(`no "${SUBAGENT_PROVIDER}" subagent provider is registered, so an agent hook cannot start`);
  }
  const childId = randomUUID();
  support.hookAgents.add(childId);
  const abort = new AbortController();
  const timeout = timeoutGuard(timeoutMs, abort);
  const late = { pending: false, release: () => support.hookAgents.delete(childId) };
  try {
    const activation = await startVerifier(ctx, {
      provider: SUBAGENT_PROVIDER,
      label: 'hook verification',
      delivery: 'caller',
      signal: abort.signal,
      childId,
      request: {
        parent: agent,
        prompt: [{ type: 'text', text: buildPrompt(hook.prompt, payload) + AGENT_INSTRUCTION }],
        outputSchema: VERDICT_SCHEMA,
      },
    }, timeout, late);
    const answer = agentVerdict(await finishActivation(activation, timeout, late));
    return answer.verdict === undefined
      ? failedRun(`agent hook: ${answer.error}`)
      : verdictToRun(event, answer.verdict, hook);
  } catch (error) {
    return failedRun(`agent hook: ${abortReason(error, timeoutMs)}`);
  } finally {
    clearTimeout(timeout.timer);
    if (!late.pending) late.release();
  }
}

/**
 * The runners for the handler types that need DSH services.
 * @param {object} ctx DSH plugin context
 * @param {object} support shared helpers, with `hookAgents`
 * @returns {{mcp_tool: Function, prompt: Function, agent: Function}}
 */
export function createModelRunners(ctx, support) {
  return {
    mcp_tool: (hook, payload, options) => runMcpToolHook(ctx, support, hook, payload, options),
    prompt: (hook, payload, options) => runPromptHook(ctx, hook, payload, options),
    agent: (hook, payload, options) => runAgentHook(ctx, support, hook, payload, options),
  };
}
