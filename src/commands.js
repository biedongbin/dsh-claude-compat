// dsh-claude-compat: native DSH human commands for the manager surface.
//
// ctx.commands (@deepseek-ai/dsh-commands): handlers run in the DSH host
// process when the user submits a slash line in the UI command plane. The
// returned text is rendered by the adapter directly and never enters model
// history — "command discovery, execution, and UI output add no model tokens".
// The same five surfaces remain model-invocable skills (see index.js), so the
// model can still read their instructions; only the human entry point moves
// off the model-mediated skill path.
//
// Registration uses the runtime guard ctx.inject(['commands'], …) — the same
// pattern as the built-in dsh-plan-mode — so hosts without the command
// service (UI-less spines, ACP automation, older DSH builds) silently skip
// this and keep working through the skill path.

import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { runPluginCommand } from './plugin-manager.js';

const execFileAsync = promisify(execFile);

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// UI cards stay small; the full output is reproducible by rerunning the
// underlying script.
const MAX_OUTPUT_CHARS = 20_000;

function clip(text) {
  const s = String(text ?? '').trim();
  return s.length <= MAX_OUTPUT_CHARS ? s : `${s.slice(0, MAX_OUTPUT_CHARS)}\n… (output truncated)`;
}

/** Run one of this package's CLI scripts as `node scripts/<name> <args>`. */
async function runScript(script, rawArgs, { cwd, signal, timeoutMs = 120_000 }) {
  const args = rawArgs.filter(Boolean);
  // The host process cwd is not the session cwd — always pin --cwd unless the
  // user passed one explicitly (both scripts treat it as an override).
  if (!args.includes('--cwd')) args.push('--cwd', cwd);
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath, [join(PLUGIN_ROOT, 'scripts', script), ...args],
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', signal });
    return { kind: 'success', text: clip(`${stdout}${stderr ? `\n${stderr}` : ''}`) };
  } catch (error) {
    if (error?.killed || error?.name === 'AbortError') {
      return { kind: 'error', text: `${script} timed out or was cancelled` };
    }
    // Script failures print their reason on stderr with a non-zero exit.
    return { kind: 'error', text: clip(error?.stderr || error?.stdout || error?.message) };
  }
}

function invocationCwd(agent) {
  return agent?.session?.header?.cwd ?? process.cwd();
}

function splitArgs(rawInput) {
  return String(rawInput ?? '').trim().split(/\s+/).filter(Boolean);
}

/** Session-cwd-pinned passthrough to a CLI script. Empty input → `list`. */
function scriptHandler(script, { timeoutMs } = {}) {
  return async ({ agent, rawInput, signal }) => {
    const args = splitArgs(rawInput);
    return runScript(script, args.length === 0 ? ['list'] : args, {
      cwd: invocationCwd(agent), signal, timeoutMs,
    });
  };
}

const RELOAD_DONE = [
  'Catalog cache dropped ✅',
  '',
  'Newly installed/removed skills are visible in this session on the next',
  'catalog read. MCP servers shipped by plugins still require a DSH restart',
  '(process-lifetime mount).',
].join('\n');

/**
 * Register the manager commands on any host that provides ctx.commands.
 * `getProvider` lazily resolves the skill provider (for cache invalidation)
 * because commands may register before the provider factory has run.
 */
export function registerManagerCommands(ctx, config, getProvider) {
  try {
    ctx.inject(['commands'], (commandCtx) => {
      const reloadHandler = async () => {
        try { getProvider()?.control?.invalidate?.(); } catch { /* best-effort */ }
        return { kind: 'success', text: RELOAD_DONE };
      };
      const defs = [
        {
          name: 'cc-resume',
          description: 'List and import Claude Code sessions into DSH',
          input: { hint: '[list|import <sessionId>] [--limit N | --limit-turns N]' },
          handler: scriptHandler('cc-resume.mjs', { timeoutMs: 300_000 }),
        },
        {
          name: 'cc-plugin',
          description: 'Manage Claude Code plugins and marketplaces',
          input: { hint: '[<name>[@marketplace]] [install|uninstall|enable|disable|update|search|marketplace ...]' },
          handler: async ({ rawInput }) => {
            // runPluginCommand owns its timeouts (claude CLI 120s, marketplace
            // ops 300s); abort merely stops the UI from awaiting.
            try {
              const text = await runPluginCommand(String(rawInput ?? ''));
              return { kind: 'success', text: clip(text) };
            } catch (error) {
              return { kind: 'error', text: clip(error?.message ?? String(error)) };
            }
          },
        },
        {
          name: 'cc-export',
          description: 'Export DSH-native skills into Claude Code .claude/skills format',
          input: { hint: '[list|export] [--target <dir>] [--overwrite]' },
          handler: scriptHandler('cc-export.mjs'),
        },
        {
          name: 'reload-cc-plugins',
          description: 'Hot-reload the skill catalog without a new session',
          input: { hint: '(no arguments)' },
          handler: reloadHandler,
        },
        {
          name: 'reload-skills',
          description: 'Hot-reload the skill catalog (alias of /reload-cc-plugins)',
          input: { hint: '(no arguments)' },
          handler: reloadHandler,
        },
      ];
      for (const definition of defs) commandCtx.commands.register(definition);
    });
  } catch {
    // Host predates ctx.inject or the command service — the manager skills
    // remain the fallback path; stay silent, this is a compatibility no-op.
  }
}
