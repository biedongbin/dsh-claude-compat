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
import {
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
    session_id: String(exec.callId),
    tool_name: exec.name,
    tool_input: exec.arguments ?? {},
  });
}

function postToolPayload(exec, result) {
  return JSON.stringify({
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
        source: { kind: 'claude-compat', form: 'hook-context' },
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

function runHookCommand(command, stdin, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    const child = execFile('/bin/sh', ['-c', command], {
      maxBuffer: 4 * 1024 * 1024,
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      console.warn(`dsh-claude-compat: hook timed out after ${timeoutMs}ms, killed: ${command}`);
      resolve({ exitCode: 1, stdout }); // treat as non-2, allow-through
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stdout += chunk; }); // surface stderr in feedback
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.warn(`dsh-claude-compat: hook command failed to start: ${command}`);
      resolve({ exitCode: 1, stdout });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout });
    });
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
// same (event, matcher, command) keys against ~/.claude/settings.json.
export function loadHookSettings(config) {
  const combined = {};
  applySettingsFile(combined, join(resolveUserClaudeDir(config.userClaudeDir), 'settings.json'));
  const projectRoot = findProjectRootSync(process.cwd(), config.projectRootMarkers);
  if (projectRoot !== undefined) {
    applySettingsFile(combined, join(projectRoot, '.claude', 'settings.json'));
  }
  return combined;
}

function applySettingsFile(combined, path) {
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
    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null) continue;
      const matcher = typeof entry.matcher === 'string' ? entry.matcher : '.*';
      const commands = Array.isArray(entry.hooks)
        ? entry.hooks
            .filter((h) => typeof h === 'object' && h !== null && typeof h.command === 'string')
            .map((h) => h.command)
        : [];
      for (const command of commands) {
        combined[`${event}\u0000${matcher}\u0000${command}`] = { event, matcher, command };
      }
    }
  }
}

// ----- listeners -------------------------------------------------------------

export function registerHooks(ctx, config) {
  const settings = loadHookSettings(config);
  const matching = (hooks, name) =>
    hooks.filter((h) => compileMatcher(h.matcher)(name));

  const pre = Object.values(settings).filter((h) => h.event === 'pre-tool-use');
  if (pre.length > 0) {
    ctx.on('tools/pre-execute', async (exec) => {
      for (const hook of matching(pre, exec.name)) {
        const payload = preToolPayload(exec);
        const run = await runHookCommand(hook.command, payload, { timeoutMs: config.hooksTimeoutMs ?? 60_000 });
        const decision = mapPreHookOutput(run.exitCode, run.stdout);
        if (decision.kind !== 'allow') return decision;
      }
      return { kind: 'allow' };
    });
  }

  const post = Object.values(settings).filter((h) => h.event === 'post-tool-use');
  if (post.length > 0) {
    ctx.on('tools/post-execute', async (exec, result) => {
      let accept;
      for (const hook of matching(post, exec.name)) {
        const payload = postToolPayload(exec, result);
        const run = await runHookCommand(hook.command, payload, { timeoutMs: config.hooksTimeoutMs ?? 60_000 });
        const decision = mapPostHookOutput(run.exitCode, run.stdout);
        if (decision.kind === 'block') return decision;
        if (decision.additionalContexts !== undefined) accept = decision;
      }
      return accept ?? { kind: 'accept' };
    });
  }

  const prompt = Object.values(settings).filter((h) => h.event === 'user-prompt-submit');
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

  // SessionStart / SessionEnd: fire-and-forget. Run hooks on session lifecycle,
  // log stdout/stderr, never block or feed output back into the loop.
  // NB: DSH agent events dispatch (carrier, name, payload) and inject the agent
  // onto the payload (fused), so read it from the payload, not the 1st arg.
  const startHooks = Object.values(settings).filter((h) => h.event === 'session-start');
  if (startHooks.length > 0) {
    ctx.on('agent/session-start', (carrier, name, { agent }) => {
      const payload = sessionStartPayload(agent);
      for (const hook of startHooks) {
        runHookCommand(hook.command, payload, { timeoutMs: config.hooksTimeoutMs ?? 60_000 })
          .then((run) => {
            if (run.exitCode !== 0) {
              console.warn(`dsh-claude-compat: SessionStart hook exited ${run.exitCode}: ${hook.command}`);
            } else if (run.stdout.trim() !== '') {
              console.log(`dsh-claude-compat: SessionStart hook output: ${run.stdout.trim()}`);
            }
          });
      }
    });
  }

  const endHooks = Object.values(settings).filter((h) => h.event === 'session-end');
  if (endHooks.length > 0) {
    ctx.on('agent/disposed', (carrier, name, { agent }) => {
      const payload = sessionEndPayload(agent);
      for (const hook of endHooks) {
        runHookCommand(hook.command, payload, { timeoutMs: config.hooksTimeoutMs ?? 60_000 })
          .then((run) => {
            if (run.exitCode !== 0) {
              console.warn(`dsh-claude-compat: SessionEnd hook exited ${run.exitCode}: ${hook.command}`);
            } else if (run.stdout.trim() !== '') {
              console.log(`dsh-claude-compat: SessionEnd hook output: ${run.stdout.trim()}`);
            }
          });
      }
    });
  }
}

async function runPromptHooks(hooks, agent, config) {
  const timeoutMs = Math.min(config.hooksTimeoutMs ?? 60_000, 10_000); // never block the loop longer than 10s
  const payload = promptPayload(agent);
  const extra = [];
  for (const hook of hooks) {
    const run = await runHookCommand(hook.command, payload, { timeoutMs });
    if (run.exitCode !== 0) continue; // non-zero: skip, never block a prompt
    const text = run.stdout.trim();
    if (text === '') continue;
    extra.push(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'claude-compat', form: 'hook-context' },
    }));
  }
  return extra.length > 0 ? extra : undefined;
}