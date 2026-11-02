// dsh-claude-compat: the answer of a prompt or agent hook, and how it becomes a hook
// run. Pure functions, so the rules can be tested without a model.
//
// The model answers `{"ok": true}` or `{"ok": false, "reason": "..."}`. Prompt hooks
// may add `"impossible": true`. Claude Code docs, "Prompt-based hooks", "Response
// schema", say what `ok: false` does on each event.

// The JSON object in the model text: the whole text, or the span from the first `{` to the
// last `}`. A model that adds a sentence or a code fence around the JSON still works.
function candidateObjects(text) {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));
  return candidates;
}

/**
 * Read the verdict in the text that a model returned.
 * @param {string} text model output
 * @returns {{ok: true, verdict: {ok: boolean, reason?: string, impossible: boolean}} | {ok: false, error: string}}
 */
export function parseVerdict(text) {
  for (const candidate of candidateObjects(text)) {
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
    if (typeof parsed.ok !== 'boolean') return { ok: false, error: 'the answer has no boolean "ok"' };
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
    if (parsed.ok === false && reason === '') return { ok: false, error: 'the answer says "ok": false with no "reason"' };
    return { ok: true, verdict: { ok: parsed.ok, reason, impossible: parsed.impossible === true } };
  }
  return { ok: false, error: 'the answer is not a JSON object' };
}

const ALLOWED = { exitCode: 0, stdout: '', failed: false };

/**
 * Turn a verdict into the run that a command hook would give for the same decision, so
 * the engine reads it with the rules of the event.
 * @param {string} event internal event name
 * @param {{ok: boolean, reason?: string, impossible?: boolean}} verdict
 * @param {{type: string, continueOnBlock?: boolean}} hook the hook that asked
 * @returns {{exitCode: number, stdout: string, failed: boolean}}
 */
export function verdictToRun(event, verdict, hook) {
  if (verdict.ok) return ALLOWED;
  const reason = verdict.reason ?? '';
  // `impossible` lets the turn end on Stop and SubagentStop. Agent hooks do not have it.
  if ((event === 'stop' || event === 'subagent-stop') && hook.type === 'prompt' && verdict.impossible) return ALLOWED;
  // The denial already happened. A PermissionRequest block becomes a deny decision.
  if (event === 'permission-denied') return ALLOWED;
  if (event === 'permission-request') {
    const decision = { behavior: 'deny', message: reason };
    const output = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } };
    return { exitCode: 0, stdout: JSON.stringify(output), failed: false };
  }
  // The reason goes back to the model as the tool error.
  if (event === 'post-tool-use-failure') {
    return { exitCode: 0, stdout: JSON.stringify({ additionalContext: reason }), failed: false };
  }
  // A teammate that is idle has already stopped. Only continueOnBlock (always on for agent
  // hooks) keeps it working.
  if (event === 'teammate-idle' && hook.type === 'prompt' && !hook.continueOnBlock) return ALLOWED;
  return { exitCode: 2, stdout: reason, failed: false };
}
