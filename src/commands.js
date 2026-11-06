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
import { createCompatibilityService } from './compat-service.js';

const execFileAsync = promisify(execFile);
const serviceOf = (ctx, name) => typeof ctx.get === 'function' ? ctx.get(name) : ctx[name];

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// UI cards stay small; the full output is reproducible by rerunning the
// underlying script.
const MAX_OUTPUT_CHARS = 20_000;

function clip(text) {
  const s = String(text ?? '').trim();
  return s.length <= MAX_OUTPUT_CHARS ? s : `${s.slice(0, MAX_OUTPUT_CHARS)}\n… (output truncated)`;
}

/** Run one of this package's CLI scripts as `node scripts/<name> <args>`. */
async function runScript(script, rawArgs, { ctx, cwd, signal, timeoutMs = 120_000 }) {
  const args = [...rawArgs];
  // The host process cwd is not the session cwd — always pin --cwd unless the
  // user passed one explicitly (both scripts treat it as an override).
  if (!args.includes('--cwd')) args.push('--cwd', cwd);
  try {
    // Desktop's process.execPath is Electron, not a Node script interpreter.
    const executable = process.versions.electron
      ? await serviceOf(ctx, 'subprocess')?.resolveExecutable('node', undefined, signal)
      : process.execPath;
    if (!executable) throw new Error('A Node executable is required to export skills.');
    const { stdout, stderr } = await execFileAsync(
      executable, [join(PLUGIN_ROOT, 'scripts', script), ...args],
      { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', signal });
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
  return [...String(rawInput ?? '').matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3]);
}

/** Session-cwd-pinned passthrough to a CLI script. Empty input → `list`. */
function scriptHandler(script, ctx, cwdFor, { timeoutMs } = {}) {
  return async ({ agent, rawInput, signal }) => {
    const args = splitArgs(rawInput);
    return runScript(script, args.length === 0 ? ['list'] : args, {
      ctx, cwd: cwdFor(agent), signal, timeoutMs,
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
export function registerManagerCommands(ctx, config, getProvider, manager) {
  const service = manager ?? createCompatibilityService(ctx, config, () => getProvider()?.control?.invalidate());
  const cwdFor = (agent) => (agent?.session ? serviceOf(ctx, 'workingDirectory')?.get(agent.session) : undefined) ?? invocationCwd(agent);
  const surface = (mode, cwd, targetSessionId) => ({ kind: 'success', text: JSON.stringify({ ui: 'claude-compat', mode, cwd,
    ...(mode === 'sessions' && targetSessionId ? { targetSessionId } : {}) }) });
  const resultOf = (result) => ({ kind: result.ok === false ? 'error' : 'success', text: clip(JSON.stringify(result)) });
  if (typeof ctx.inject !== 'function') return;
  ctx.inject(['commands'], (commandCtx) => {
      const reloadHandler = async () => {
        const provider = getProvider();
        if (typeof provider?.control?.invalidate !== 'function') throw new Error('The Claude skill provider is unavailable; skills may be disabled.');
        await provider.control.invalidate();
        return { kind: 'success', text: RELOAD_DONE };
      };
      const defs = [
        {
          name: 'cc-resume',
          description: 'Browse Claude Code history and ask the current DSH conversation to read its file and summarize background, task state and next steps',
          input: { hint: '[list | resume <Claude sessionId> [--cwd path] [--limit-turns N] | archive <sessionId>] — no arguments opens the session browser' },
          handler: async ({ agent, rawInput, signal }) => {
            const args = splitArgs(rawInput);
            const cwd = cwdFor(agent);
            const targetSessionId = agent?.id ?? agent?.session?.id;
            if (!args.length || args[0] === 'pick') return surface('sessions', cwd, targetSessionId);
            try {
              const sourceAt = args.indexOf('--cwd');
              const sourceCwd = sourceAt >= 0 ? args[sourceAt + 1] : cwd;
              if (args[0] === 'list') return resultOf(await service.execute({ action: 'sessions.list', cwd: sourceCwd, limit: 10 }, signal));
              if (!['resume', 'import', 'archive'].includes(args[0]) || !args[1]) throw new Error('Use /cc-resume, /cc-resume list or /cc-resume resume <full Claude session id>.');
              const archive = args[0] === 'archive';
              if (!archive && !targetSessionId) throw new Error('The current DSH conversation could not be identified.');
              const at = args.indexOf('--limit-turns');
              const request = { action: archive ? 'sessions.import' : 'sessions.resume', cwd: sourceCwd, sessionId: args[1],
                ...(at >= 0 ? { limitTurns: Number(args[at + 1]) } : {}),
                ...(archive ? { newSnapshot: args.includes('--new-snapshot') } : { targetSessionId }) };
              return resultOf(await service.execute(request, signal));
            } catch (error) { return { kind: 'error', text: error.message }; }
          },
        },
        {
          name: 'cc-plugin',
          description: 'Manage Claude Code plugins and marketplaces',
          input: { hint: '[<name>[@marketplace]] [install|uninstall|enable|disable|update|search|marketplace ...]' },
          handler: async ({ agent, rawInput, signal }) => {
            const args = splitArgs(rawInput);
            const cwd = cwdFor(agent);
            if (!args.length) return surface('plugins', cwd);
            let [action, ...rest] = args;
            if (action === 'remove') action = 'uninstall';
            if (action === 'marketplace') { const [sub, ...tail] = rest; action = `marketplace-${sub === 'rm' ? 'remove' : sub}`; rest = tail; }
            else if (!['list', 'search', 'install', 'uninstall', 'enable', 'disable', 'update'].includes(action)) { rest = [action, ...rest]; action = 'install'; }
            try {
              return resultOf(await service.execute({ action: `plugins.${action}`, cwd,
                ...(action === 'search' ? { query: rest.join(' ') } : rest.length ? { target: rest.join(' ') } : {}) }, signal));
            } catch (error) { return { kind: 'error', text: error.message }; }
          },
        },
        {
          name: 'cc-export',
          description: 'Export DSH-native skills into Claude Code .claude/skills format',
          input: { hint: '[list|export] [--target <dir>] [--overwrite]' },
          handler: scriptHandler('cc-export.mjs', ctx, cwdFor),
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
      for (const definition of defs) commandCtx.commands.register({ ...definition,
        async handler(invocation) {
          try { return await definition.handler(invocation); }
          catch (error) { return { kind: 'error', text: clip(error?.message ?? String(error)) }; }
        },
      });
  });
}
