// dsh-claude-compat: Claude Code hooks subset (PreToolUse / PostToolUse /
// UserPromptSubmit / SessionStart / SessionEnd) bridged onto DSH's
// tools/pre-execute, tools/post-execute, agent/pre-step, and session waterfalls.
//
// Hooks are read from ~/.claude/settings.json and <projectRoot>/.claude/settings.json.
// The project file is applied last, so its entry wins when both are identical.
// A command runs in /bin/sh -c, or directly when `args` is set (see
// src/hook-spec.js). Hooks get a Claude-style JSON payload on stdin. Decisions
// follow Claude Code semantics: exit 2 = deny/block, hookSpecificOutput overrides.
// A hook that times out, cannot start, or exits with another code counts as
// failed. It is logged with its reason and allows the action, unless
// onFailure is "block".

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { matchIfRule, parseHookHandler } from './hook-spec.js';
import {
  CLAUDE_COMPAT_SOURCE_KIND,
  findProjectRootSync,
  resolveUserClaudeDir,
} from './lib.js';

// Compile a Claude Code hook matcher ("Bash", "Bash|Edit", ".*") into a
// predicate. Exact names match exactly; `*` / `.*` are wildcards; `|`
// alternates.
export function compileMatcher(matcher) {
  if (typeof matcher !== 'string') return () => false;
  const trimmed = matcher.trim();
  if (trimmed === '' || trimmed === '*' || trimmed === '.*') return () => true;
  try {
    const pattern = trimmed
      .split('|')
      .map((part) => part.trim().split('*').join('.*'))
      .join('|');
    const re = new RegExp(`^(?:${pattern})$`);
    return (name) => re.test(name);
  } catch {
    return () => false;
  }
}

// ----- payloads ---------------------------------------------------------------

function basePayload(eventName) {
  return { hook_event_name: eventName, cwd: process.cwd() };
}

function preToolPayload(exec) {
  return JSON.stringify({
    ...basePayload('PreToolUse'),
    session_id: String(exec.callId),
    tool_name: exec.name,
    tool_input: exec.arguments ?? {},
  });
}

function postToolPayload(exec, result) {
  return JSON.stringify({
    ...basePayload('PostToolUse'),
    tool_name: exec.name,
    tool_input: exec.arguments ?? {},
    tool_response: result,
  });
}

function promptPayload(agent) {
  let prompt = '';
  const events = agent.session?.events ?? {};
  for (const event of Object.values(events)) {
    const data = event?.data;
    if (event?.type?.endsWith('user/message') && typeof data?.content === 'string') {
      prompt = data.content;
    }
  }
  return JSON.stringify({ ...basePayload('UserPromptSubmit'), prompt });
}

// ----- decision mapping (pure, exported for tests) -----------------------------

// PreToolUse: exit 0 → allow; exit 2 → deny (stdout reason); other codes →
// allow with warning. stdout JSON {"hookSpecificOutput": {...permissionDecision}}
// overrides: "deny" → deny, "ask" → ask (best effort).
export function mapPreHookOutput(exitCode, stdout, { warn = console.warn } = {}) {
  if (exitCode === 0) {
    const specific = tryHookJson(stdout)?.hookSpecificOutput;
    if (specific?.permissionDecision === 'deny') {
      return { kind: 'deny', reason: String(specific.permissionDecisionReason ?? fallbackReason(stdout)) };
    }
    if (specific?.permissionDecision === 'ask') {
      return { kind: 'ask', reason: String(specific.permissionDecisionReason ?? 'hook requests approval') };
    }
    return { kind: 'allow' };
  }
  if (exitCode === 2) {
    return { kind: 'deny', reason: fallbackReason(stdout) };
  }
  warn(`dsh-claude-compat: PreToolUse hook exited with code ${exitCode}, allowing`);
  return { kind: 'allow' };
}

// PostToolUse: exit 2 → block (stdout feedback); exit 0 with JSON stdout
// carrying an "additionalContext" string → accept with that context as an
// additional user message; anything else → accept, stdout log-only.
export function mapPostHookOutput(exitCode, stdout, { warn = console.warn } = {}) {
  if (exitCode === 2) {
    return { kind: 'block', feedback: [{ type: 'text', text: fallbackReason(stdout) }] };
  }
  if (exitCode !== 0) {
    warn(`dsh-claude-compat: PostToolUse hook exited with code ${exitCode}, accepting`);
    return { kind: 'accept' };
  }
  const trimmed = stdout.trim();
  if (trimmed === '') return { kind: 'accept' };
  const additional = tryHookJson(stdout)?.additionalContext;
  if (typeof additional === 'string' && additional.length > 0) {
    return {
      kind: 'accept',
      additionalContexts: [createUserMessage({
        content: [{ type: 'text', text: additional }],
        source: { kind: CLAUDE_COMPAT_SOURCE_KIND, form: 'hook-context' },
      })],
    };
  }
  console.log(`dsh-claude-compat: PostToolUse hook stdout (logged, not injected): ${trimmed}`);
  return { kind: 'accept' };
}

function fallbackReason(stdout) {
  const trimmed = stdout.trim();
  return trimmed !== '' ? trimmed : 'blocked by hook';
}

function tryHookJson(stdout) {
  const s = stdout.trim();
  if (s === '') return undefined;
  try { return JSON.parse(s); } catch { return undefined; }
}

// ----- runner ---------------------------------------------------------------

function hookEnv(hook) {
  return { ...process.env, CLAUDE_PROJECT_DIR: hook.projectDir };
}

// Stop the hook and whatever it started. Shell form runs a child of /bin/sh,
// so the whole process group is signalled. If the group is already gone, only
// the direct child can be killed.
function killHook(child) {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

// Why a run ended without a usable decision. Exit 0 and exit 2 are decisions.
function closeReason(code, signal) {
  if (code === 0 || code === 2) return undefined;
  return code === null ? `killed by ${signal}` : `exit ${code}`;
}

/**
 * Run one hook. Resolves with { exitCode, stdout, failed, reason }. Never
 * rejects: a hook that cannot start is a failed run, not an error in a listener.
 * `failed` is true for a timeout, a start error, a signal, or an exit code other
 * than 0 or 2. `reason` says why and is set only when `failed` is true.
 * @param {object} hook handler from loadHookSettings
 * @param {string} stdin JSON payload
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{exitCode: number, stdout: string, failed: boolean, reason?: string}>}
 */
export function runHookCommand(hook, stdin, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    let timer;
    const finish = (exitCode, failed, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, failed, reason });
    };
    const [file, argv] = hook.args === undefined
      ? ['/bin/sh', ['-c', hook.command]]
      : [hook.command, hook.args];
    let child;
    try {
      child = spawn(file, argv, { detached: true, env: hookEnv(hook) });
    } catch (error) {
      // Thrown, not emitted, for an argument Node refuses (for example a NUL byte).
      finish(1, true, `cannot start: ${error.message}`);
      return;
    }
    timer = setTimeout(() => {
      killHook(child);
      finish(1, true, `timed out after ${timeoutMs}ms`);
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stdout += chunk; }); // stderr joins the feedback
    child.on('error', (error) => finish(1, true, `failed to start: ${error.code ?? error.message}`));
    child.on('close', (code, signal) => finish(code ?? 1, code !== 0 && code !== 2, closeReason(code, signal)));
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') console.warn(`dsh-claude-compat: hook stdin error: ${error.message}`);
    });
    child.stdin.end(stdin);
  });
}

// One hook run, with the handler's own timeout capped by `capMs`.
function runEntry(hook, stdin, config, capMs = Infinity) {
  const timeoutMs = Math.min(hook.timeoutMs ?? config.hooksTimeoutMs ?? 60_000, capMs);
  return runHookCommand(hook, stdin, { timeoutMs });
}

// Log text for a failed run: the reason, the hook, and the end of its output.
function failureText(run, hook) {
  const tail = run.stdout.trim();
  return `${run.reason}: ${hook.command}${tail === '' ? '' : ` (output: ${tail.slice(-500)})`}`;
}

// ----- decisions from one run ------------------------------------------------

function preDecision(run, hook) {
  if (!run.failed) return mapPreHookOutput(run.exitCode, run.stdout);
  console.warn(`dsh-claude-compat: PreToolUse hook failed, ${failureText(run, hook)}`);
  return hook.onFailure === 'block'
    ? { kind: 'deny', reason: `hook failed, ${failureText(run, hook)}` }
    : { kind: 'allow' };
}

function postDecision(run, hook) {
  if (!run.failed) return mapPostHookOutput(run.exitCode, run.stdout);
  console.warn(`dsh-claude-compat: PostToolUse hook failed, ${failureText(run, hook)}`);
  return hook.onFailure === 'block'
    ? { kind: 'block', feedback: [{ type: 'text', text: `hook failed, ${failureText(run, hook)}` }] }
    : { kind: 'accept' };
}

// Hooks whose matcher and `if` rule both match this tool call.
function eligibleFor(hooks, exec) {
  return hooks.filter((h) => compileMatcher(h.matcher)(exec.name)
    && (h.ifRule === undefined || matchIfRule(h.ifRule, exec.name, exec.arguments)));
}

// `async` hooks run in the background. They cannot change the decision, so
// their failures are logged here.
function runInBackground(hook, stdin, config) {
  runEntry(hook, stdin, config).then((run) => {
    if (run.failed) console.warn(`dsh-claude-compat: async hook failed, ${failureText(run, hook)}`);
    else if (run.exitCode === 2) console.warn(`dsh-claude-compat: async hook exit 2 cannot block, ignored: ${hook.command}`);
  });
}

async function runPreHooks(hooks, exec, config) {
  for (const hook of eligibleFor(hooks, exec)) {
    const payload = preToolPayload(exec);
    if (hook.async) { runInBackground(hook, payload, config); continue; }
    const decision = preDecision(await runEntry(hook, payload, config), hook);
    if (decision.kind !== 'allow') return decision;
  }
  return { kind: 'allow' };
}

async function runPostHooks(hooks, exec, result, config) {
  const contexts = [];
  for (const hook of eligibleFor(hooks, exec)) {
    const payload = postToolPayload(exec, result);
    if (hook.async) { runInBackground(hook, payload, config); continue; }
    const decision = postDecision(await runEntry(hook, payload, config), hook);
    if (decision.kind === 'block') return decision;
    if (decision.additionalContexts !== undefined) contexts.push(...decision.additionalContexts);
  }
  return contexts.length > 0 ? { kind: 'accept', additionalContexts: contexts } : { kind: 'accept' };
}

// SessionStart / SessionEnd: fire-and-forget, output logged, never fed back.
function runSessionHook(hook, stdin, config, label) {
  runEntry(hook, stdin, config).then((run) => {
    if (run.failed) console.warn(`dsh-claude-compat: ${label} hook failed, ${failureText(run, hook)}`);
    else if (run.stdout.trim() !== '') console.log(`dsh-claude-compat: ${label} hook output: ${run.stdout.trim()}`);
  });
}

// ----- settings loading ------------------------------------------------------

const EVENTS = {
  PreToolUse: 'pre-tool-use',
  PostToolUse: 'post-tool-use',
  UserPromptSubmit: 'user-prompt-submit',
  // SessionStart / SessionEnd are notification-style hooks: DSH has no
  // `agent/notification` event (Claude Code's Notification hook has no DSH
  // equivalent), but SessionStart → agent/session-start and SessionEnd →
  // agent/disposed map cleanly.
  SessionStart: 'session-start',
  SessionEnd: 'session-end',
};

function sessionFields(eventName, agent) {
  return {
    hook_event_name: eventName,
    session_id: agent?.session?.id ?? 'unknown',
    cwd: agent?.session?.header?.cwd ?? process.cwd(),
  };
}

// Exported for hermetic tests.
export function sessionStartPayload(agent) {
  return JSON.stringify(sessionFields('SessionStart', agent));
}

export function sessionEndPayload(agent) {
  return JSON.stringify({ ...sessionFields('SessionEnd', agent), reason: 'session_end' });
}

// Combined hooks map. Project .claude/settings.json is applied LAST so it wins
// same (event, matcher, handler) keys against ~/.claude/settings.json.
export function loadHookSettings(config) {
  const combined = {};
  const found = findProjectRootSync(process.cwd(), config.projectRootMarkers);
  const projectDir = found ?? process.cwd();
  applySettingsFile(combined, join(resolveUserClaudeDir(config.userClaudeDir), 'settings.json'), projectDir);
  if (found !== undefined) {
    applySettingsFile(combined, join(found, '.claude', 'settings.json'), projectDir);
  }
  return combined;
}

function warnAt(path, message) {
  console.warn(`dsh-claude-compat: ${message} (${path})`);
}

function applySettingsFile(combined, path, projectDir) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    warnAt(path, 'unparseable settings.json');
    return;
  }
  const hooks = parsed?.hooks;
  if (typeof hooks !== 'object' || hooks === null || Array.isArray(hooks)) return;
  for (const [eventName, entries] of Object.entries(hooks)) {
    const event = EVENTS[eventName];
    if (event === undefined) {
      warnAt(path, `hook event "${eventName}" is not supported, skipped`);
      continue;
    }
    if (!Array.isArray(entries)) {
      warnAt(path, `hooks.${eventName} must be a list, skipped`);
      continue;
    }
    for (const entry of entries) addEntry(combined, { path, event, projectDir }, entry);
  }
}

function addEntry(combined, scope, entry) {
  if (typeof entry !== 'object' || entry === null || !Array.isArray(entry.hooks)) {
    warnAt(scope.path, 'malformed hook entry skipped');
    return;
  }
  if (entry.matcher !== undefined && typeof entry.matcher !== 'string') {
    warnAt(scope.path, 'hook matcher must be a string; entry skipped');
    return;
  }
  const matcher = entry.matcher ?? '.*';
  for (const raw of entry.hooks) addHandler(combined, { ...scope, matcher }, raw);
}

function addHandler(combined, scope, raw) {
  const result = parseHookHandler(raw, { event: scope.event, projectDir: scope.projectDir });
  if (!result.ok) {
    warnAt(scope.path, `hook skipped: ${result.reason}`);
    return;
  }
  for (const note of result.notes) warnAt(scope.path, `hook note: ${note}`);
  const key = `${scope.event}\u0000${scope.matcher}\u0000${JSON.stringify(result.handler)}`;
  combined[key] = { event: scope.event, matcher: scope.matcher, ...result.handler };
}

// ----- listeners -------------------------------------------------------------

export function registerHooks(ctx, config) {
  const settings = Object.values(loadHookSettings(config));
  const byEvent = (name) => settings.filter((h) => h.event === name);

  const pre = byEvent('pre-tool-use');
  if (pre.length > 0) {
    ctx.on('tools/pre-execute', (exec) => runPreHooks(pre, exec, config));
  }

  const post = byEvent('post-tool-use');
  if (post.length > 0) {
    ctx.on('tools/post-execute', (exec, result) => runPostHooks(post, exec, result, config));
  }

  const prompt = byEvent('user-prompt-submit');
  if (prompt.length > 0) {
    ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
      const decision = await next();
      if (decision.kind !== 'enter') return decision;
      // First enter of the turn: the DSH loop hands the step the user claims,
      // which is where Claude Code would have fired UserPromptSubmit. Hook
      // output becomes an extra user message appended after the claimed ones.
      const extra = await runPromptHooks(prompt, agent, config);
      if (extra === undefined) return decision;
      return { kind: 'enter', messages: decision.messages.concat(extra) };
    });
  }

  // NB: DSH agent events dispatch (carrier, name, payload). The agent is NOT
  // in a fixed position: agent-loop's emitAgentEvent fuses it onto the payload
  // (payload.agent), while the headless path passes it on the carrier
  // (carrier.agent). Read both defensively.
  const startHooks = byEvent('session-start');
  if (startHooks.length > 0) {
    ctx.on('agent/session-start', (carrier, name, payload) => {
      const hookPayload = sessionStartPayload(carrier?.agent ?? payload?.agent);
      for (const hook of startHooks) runSessionHook(hook, hookPayload, config, 'SessionStart');
    });
  }

  const endHooks = byEvent('session-end');
  if (endHooks.length > 0) {
    ctx.on('agent/disposed', (carrier, name, payload) => {
      const hookPayload = sessionEndPayload(carrier?.agent ?? payload?.agent);
      for (const hook of endHooks) runSessionHook(hook, hookPayload, config, 'SessionEnd');
    });
  }
}

async function runPromptHooks(hooks, agent, config) {
  const payload = promptPayload(agent);
  const extra = [];
  for (const hook of hooks) {
    // Never block the loop longer than 10s.
    const run = await runEntry(hook, payload, config, 10_000);
    if (run.failed) {
      console.warn(`dsh-claude-compat: UserPromptSubmit hook failed, ${failureText(run, hook)}`);
      continue;
    }
    if (run.exitCode === 2) {
      console.warn(`dsh-claude-compat: UserPromptSubmit exit 2 cannot block here, ignored: ${hook.command}`);
      continue;
    }
    const text = run.stdout.trim();
    if (text === '') continue;
    extra.push(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: CLAUDE_COMPAT_SOURCE_KIND, form: 'hook-context' },
    }));
  }
  return extra.length > 0 ? extra : undefined;
}
