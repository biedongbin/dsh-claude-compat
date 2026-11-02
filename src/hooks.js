// dsh-claude-compat: Claude Code hooks subset (PreToolUse / PostToolUse /
// UserPromptSubmit) bridged onto DSH's tools/pre-execute, tools/post-execute,
// and agent/pre-step waterfalls.
//
// Hooks are read from <projectRoot>/.claude/settings.json (and ~/.claude/
// settings.json; project wins on duplicate command strings). Commands run via
// /bin/sh -c with a Claude-style JSON payload on stdin. Decisions follow Claude
// Code semantics (exit code 2 = deny/block, hookSpecificOutput override,
// timeouts allowed-through with a warning).

import { execFile } from 'node:child_process';
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

function preToolPayload(exec) {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    cwd: process.cwd(),
    session_id: String(exec.callId),
    tool_name: exec.name,
    tool_input: exec.arguments ?? {},
  });
}

function postToolPayload(exec, result) {
  return JSON.stringify({
    hook_event_name: 'PostToolUse',
    cwd: process.cwd(),
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
  return JSON.stringify({ prompt });
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

// A hook counts as failed when it times out, cannot start, or exits with a code
// other than 0 (ok) or 2 (block). `onFailure: "block"` turns a failed hook into
// a block. Exec form (`args`) runs the program without a shell.
export function runHookCommand(hook, stdin, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    const finish = (exitCode, failed) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, failed });
    };
    const [file, argv] = hook.args === undefined
      ? ['/bin/sh', ['-c', hook.command]]
      : [hook.command, hook.args];
    const env = { ...process.env, CLAUDE_PROJECT_DIR: hook.projectDir };
    const child = execFile(file, argv, { maxBuffer: 4 * 1024 * 1024, env });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      console.warn(`dsh-claude-compat: hook timed out after ${timeoutMs}ms, killed: ${hook.command}`);
      finish(1, true);
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stdout += chunk; }); // surface stderr in feedback
    child.on('error', () => {
      console.warn(`dsh-claude-compat: hook command failed to start: ${hook.command}`);
      finish(1, true);
    });
    child.on('close', (code) => finish(code ?? 1, code !== 0 && code !== 2));
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
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
  // agent/disposed map cleanly. These run fire-and-forget (their output is
  // logged, never fed back into the loop).
  SessionStart: 'session-start',
  SessionEnd: 'session-end',
};

// Session hooks are async (not decision-bearing). They run best-effort:
// a non-zero exit is logged, never blocks a session start/end.
// Exported for hermetic tests.
export function sessionStartPayload(agent) {
  const cwd = agent?.session?.header?.cwd ?? process.cwd();
  const sessionId = agent?.session?.id ?? 'unknown';
  return JSON.stringify({ session_id: sessionId, cwd });
}

function sessionEndPayload(agent) {
  const cwd = agent?.session?.header?.cwd ?? process.cwd();
  const sessionId = agent?.session?.id ?? 'unknown';
  return JSON.stringify({ session_id: sessionId, cwd, reason: 'session_end' });
}

// Re-export for hermetic tests (keeps the single definition above authoritative).
export { sessionEndPayload };

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

function applySettingsFile(combined, path, projectDir) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    console.warn(`dsh-claude-compat: unparseable settings.json: ${path}`);
    return;
  }
  const hooks = parsed?.hooks;
  if (typeof hooks !== 'object' || hooks === null || Array.isArray(hooks)) return;
  for (const [eventName, entries] of Object.entries(hooks)) {
    const event = EVENTS[eventName];
    if (event === undefined || !Array.isArray(entries)) continue;
    for (const entry of entries) addEntry(combined, path, event, entry, projectDir);
  }
}

function addEntry(combined, path, event, entry, projectDir) {
  if (typeof entry !== 'object' || entry === null || !Array.isArray(entry.hooks)) return;
  const matcher = typeof entry.matcher === 'string' ? entry.matcher : '.*';
  for (const raw of entry.hooks) {
    const result = parseHookHandler(raw, { event, projectDir });
    if (!result.ok) {
      console.warn(`dsh-claude-compat: hook skipped in ${path}: ${result.reason}`);
      continue;
    }
    const key = `${event}\u0000${matcher}\u0000${JSON.stringify(result.handler)}`;
    combined[key] = { event, matcher, ...result.handler };
  }
}

// ----- listeners -------------------------------------------------------------

// One hook run, with the handler's own timeout capped by `capMs`.
function runEntry(hook, stdin, config, capMs = Infinity) {
  const timeoutMs = Math.min(hook.timeoutMs ?? config.hooksTimeoutMs ?? 60_000, capMs);
  return runHookCommand(hook, stdin, { timeoutMs });
}

// Hooks whose matcher and `if` rule both match this tool call.
function eligibleFor(hooks, exec) {
  return hooks.filter((h) => compileMatcher(h.matcher)(exec.name)
    && (h.ifRule === undefined || matchIfRule(h.ifRule, exec.name, exec.arguments)));
}

// `async` hooks run in the background and cannot change the decision.
function runInBackground(hook, stdin, config) {
  runEntry(hook, stdin, config).then((run) => {
    if (run.failed) console.warn(`dsh-claude-compat: async hook failed (exit ${run.exitCode}): ${hook.command}`);
  });
}

// SessionStart / SessionEnd: fire-and-forget, output logged, never fed back.
function runSessionHook(hook, stdin, config, label) {
  runEntry(hook, stdin, config).then((run) => {
    if (run.exitCode !== 0) {
      console.warn(`dsh-claude-compat: ${label} hook exited ${run.exitCode}: ${hook.command}`);
    } else if (run.stdout.trim() !== '') {
      console.log(`dsh-claude-compat: ${label} hook output: ${run.stdout.trim()}`);
    }
  });
}

export function registerHooks(ctx, config) {
  const settings = Object.values(loadHookSettings(config));
  const byEvent = (name) => settings.filter((h) => h.event === name);

  const pre = byEvent('pre-tool-use');
  if (pre.length > 0) {
    ctx.on('tools/pre-execute', async (exec) => {
      for (const hook of eligibleFor(pre, exec)) {
        const payload = preToolPayload(exec);
        if (hook.async) { runInBackground(hook, payload, config); continue; }
        const run = await runEntry(hook, payload, config);
        const decision = run.failed && hook.onFailure === 'block'
          ? { kind: 'deny', reason: `hook failed: ${hook.command}` }
          : mapPreHookOutput(run.exitCode, run.stdout);
        if (decision.kind !== 'allow') return decision;
      }
      return { kind: 'allow' };
    });
  }

  const post = byEvent('post-tool-use');
  if (post.length > 0) {
    ctx.on('tools/post-execute', async (exec, result) => {
      let accept;
      for (const hook of eligibleFor(post, exec)) {
        const payload = postToolPayload(exec, result);
        if (hook.async) { runInBackground(hook, payload, config); continue; }
        const run = await runEntry(hook, payload, config);
        const decision = run.failed && hook.onFailure === 'block'
          ? { kind: 'block', feedback: [{ type: 'text', text: `hook failed: ${hook.command}` }] }
          : mapPostHookOutput(run.exitCode, run.stdout);
        if (decision.kind === 'block') return decision;
        if (decision.additionalContexts !== undefined) accept = decision;
      }
      return accept ?? { kind: 'accept' };
    });
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
    const run = await runEntry(hook, payload, config, 10_000); // never block the loop longer than 10s
    if (run.exitCode !== 0) continue; // non-zero: skip, never block a prompt
    const text = run.stdout.trim();
    if (text === '') continue;
    extra.push(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: CLAUDE_COMPAT_SOURCE_KIND, form: 'hook-context' },
    }));
  }
  return extra.length > 0 ? extra : undefined;
}