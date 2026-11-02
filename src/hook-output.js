// dsh-claude-compat: turn one hook run (exit code + stdout) into a normalized
// outcome, following the Claude Code rules for each event. Pure functions, so
// the rules can be tested without DSH. The DSH bridges map an outcome onto a
// DSH decision.
//
// Source: https://code.claude.com/docs/en/hooks ("Exit codes", "Universal JSON
// output fields", and the decision control of each event).

// Exit code 2 is a blocking error on these events. PostToolUse is here because
// this bridge has always turned exit 2 there into feedback for the model.
const EXIT2_BLOCKS = new Set([
  'user-prompt-submit',
  'user-prompt-expansion',
  'pre-tool-use',
  'post-tool-use',
  'post-tool-batch',
  'subagent-stop',
  'task-created',
  'task-completed',
  'stop',
  'teammate-idle',
  'config-change',
  'pre-compact',
  'pre-model-switch',
]);

// A top-level `decision: "block"` in JSON output blocks on these events.
const DECISION_BLOCKS = new Set([
  'user-prompt-submit',
  'user-prompt-expansion',
  'post-tool-use',
  'post-tool-batch',
  'subagent-stop',
  'task-created',
  'stop',
  'config-change',
  'pre-compact',
]);

// Plain stdout on exit 0 is added as context only on these events.
const STDOUT_CONTEXT = new Set([
  'user-prompt-submit',
  'user-prompt-expansion',
  'session-start',
  'post-model-switch',
]);

// Higher wins when several PreToolUse hooks disagree.
const PERMISSION_RANK = { deny: 4, defer: 3, ask: 2, allow: 1 };

function jsonObject(stdout) {
  const text = stdout.trim();
  if (!text.startsWith('{')) return undefined;
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// `hookSpecificOutput` names its event. A block for another event is dropped,
// the same as the DSH bridge does, because the schemas are keyed by event.
function specificOutput(json, claudeName) {
  const specific = json?.hookSpecificOutput;
  if (typeof specific !== 'object' || specific === null || Array.isArray(specific)) return {};
  if (specific.hookEventName !== undefined && specific.hookEventName !== claudeName) return {};
  return specific;
}

function emptyOutcome() {
  return {
    failed: false,
    reason: undefined,
    blocked: false,
    stopped: false,
    stopReason: undefined,
    systemMessage: undefined,
    contexts: [],
    permission: undefined,
    permissionReason: undefined,
    updatedInput: undefined,
    updatedToolOutput: undefined,
    watchPaths: [],
    retry: false,
    specific: {},
    text: '',
  };
}

function contextsOf(json, specific) {
  const found = [specific.additionalContext, json?.additionalContext];
  return found.filter((text) => typeof text === 'string' && text !== '');
}

function legacyPermission(json) {
  if (json?.decision === 'approve') return 'allow';
  if (json?.decision === 'block') return 'deny';
  return undefined;
}

function applyJson(outcome, event, json, specific) {
  if (json === undefined) return;
  outcome.stopped = json.continue === false;
  outcome.stopReason = typeof json.stopReason === 'string' ? json.stopReason : undefined;
  outcome.systemMessage = typeof json.systemMessage === 'string' ? json.systemMessage : undefined;
  if (DECISION_BLOCKS.has(event) && json.decision === 'block') {
    outcome.blocked = true;
    outcome.reason = typeof json.reason === 'string' ? json.reason : outcome.reason;
  }
  if (event === 'pre-tool-use') {
    outcome.permission = specific.permissionDecision ?? legacyPermission(json);
    outcome.permissionReason = specific.permissionDecisionReason
      ?? (typeof json.reason === 'string' ? json.reason : undefined);
  }
  outcome.updatedInput = specific.updatedInput;
  outcome.updatedToolOutput = specific.updatedToolOutput;
  outcome.retry = specific.retry === true;
  outcome.watchPaths = Array.isArray(specific.watchPaths)
    ? specific.watchPaths.filter((p) => typeof p === 'string') : [];
}

/**
 * Interpret one hook run for an event.
 * A run that failed (timeout, start error, bad exit code) is not interpreted:
 * the caller decides what a failure means (see `onFailure`).
 * @param {string} event internal event name, for example "pre-tool-use"
 * @param {string} claudeName Claude event name, for example "PreToolUse"
 * @param {{exitCode: number, stdout: string, failed: boolean, reason?: string}} run
 * @returns {object} outcome with blocked, reason, contexts, permission, and more
 */
export function interpretRun(event, claudeName, run) {
  const outcome = emptyOutcome();
  outcome.text = run.stdout.trim();
  if (run.failed) {
    outcome.failed = true;
    outcome.reason = run.reason;
    return outcome;
  }
  const json = jsonObject(run.stdout);
  const specific = specificOutput(json, claudeName);
  outcome.specific = specific;
  outcome.contexts = contextsOf(json, specific);
  applyJson(outcome, event, json, specific);
  if (run.exitCode === 2 && EXIT2_BLOCKS.has(event)) {
    const text = outcome.text === '' ? undefined : outcome.text;
    outcome.blocked = true;
    outcome.reason = json === undefined ? text : (outcome.reason ?? text);
  }
  if (STDOUT_CONTEXT.has(event) && run.exitCode === 0 && json === undefined && outcome.text !== '') {
    outcome.contexts = [outcome.text];
  }
  return outcome;
}

function strongerPermission(left, right) {
  return (PERMISSION_RANK[right] ?? 0) > (PERMISSION_RANK[left] ?? 0) ? right : left;
}

/**
 * Fold the outcomes of every hook that ran for one event into one outcome.
 * Any block wins. Permission follows deny > defer > ask > allow. Contexts and
 * watch paths are joined. The last updated input or tool output wins.
 * @param {object[]} outcomes from interpretRun
 * @returns {object}
 */
export function mergeOutcomes(outcomes) {
  const merged = emptyOutcome();
  for (const outcome of outcomes) {
    if (outcome.failed) continue;
    merged.blocked ||= outcome.blocked;
    merged.reason ??= outcome.blocked ? outcome.reason : undefined;
    merged.stopped ||= outcome.stopped;
    merged.stopReason ??= outcome.stopReason;
    merged.systemMessage = [merged.systemMessage, outcome.systemMessage].filter(Boolean).join('\n') || undefined;
    merged.contexts.push(...outcome.contexts);
    merged.permission = strongerPermission(merged.permission, outcome.permission);
    merged.permissionReason ??= outcome.permission === merged.permission ? outcome.permissionReason : undefined;
    merged.updatedInput = outcome.updatedInput ?? merged.updatedInput;
    merged.updatedToolOutput = outcome.updatedToolOutput ?? merged.updatedToolOutput;
    merged.retry ||= outcome.retry;
    for (const path of outcome.watchPaths) if (!merged.watchPaths.includes(path)) merged.watchPaths.push(path);
    if (Object.keys(outcome.specific).length > 0) merged.specific = { ...merged.specific, ...outcome.specific };
  }
  return merged;
}
