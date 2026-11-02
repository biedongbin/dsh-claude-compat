// dsh-claude-compat: Claude Code hooks bridged onto DSH.
//
// Hooks are read from ~/.claude/settings.json and <projectRoot>/.claude/settings.json.
// The project file is applied last, so its entry wins when both are identical.
// Handler types: command (/bin/sh -c, or direct with `args`), http, mcp_tool,
// prompt, agent. Hooks get a Claude-style JSON payload. Decisions follow Claude
// Code semantics (see src/hook-output.js). A hook that times out, cannot start,
// or exits with another code counts as failed: it is logged with its reason and
// allows the action, unless `onFailure` is "block".
//
// Layout: hook-events.js (event table), hook-spec.js (parsing), hook-handlers.js
// (runners), hook-output.js (decisions), hook-engine.js (runs one event), and
// the hook-bridge-*.js files (one DSH extension point each).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLAUDE_EVENTS, UNSUPPORTED_EVENTS } from './hook-events.js';
import { createHookEngine } from './hook-engine.js';
import { registerAgentHooks } from './hook-bridge-agent.js';
import { registerMessageHooks } from './hook-bridge-messages.js';
import { registerNotificationHooks } from './hook-bridge-notify.js';
import { registerPermissionHooks } from './hook-bridge-permissions.js';
import { registerTaskHooks } from './hook-bridge-tasks.js';
import { registerSessionHooks } from './hook-bridge-session.js';
import { registerToolHooks } from './hook-bridge-tools.js';
import { createSupport } from './hook-support.js';
import { parseHookHandler } from './hook-spec.js';
import { findProjectRootSync, resolveUserClaudeDir } from './lib.js';

export { compileMatcher } from './hook-engine.js';
export { runHookCommand } from './hook-handlers.js';

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
    const event = CLAUDE_EVENTS[eventName];
    if (event === undefined) {
      warnAt(path, `hook event "${eventName}" is not a Claude Code event, skipped`);
      continue;
    }
    if (UNSUPPORTED_EVENTS.has(event)) {
      warnAt(path, `hook event "${eventName}" cannot run in DSH: ${UNSUPPORTED_EVENTS.get(event)}`);
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

/**
 * Load the hook settings and register one DSH listener per event in use.
 * @param {object} ctx DSH plugin context
 * @param {object} config plugin config
 * @param {{runners?: object}} [options] runner overrides for tests
 * @returns {object} the engine, for tests
 */
export function registerHooks(ctx, config, { runners } = {}) {
  const hooks = Object.values(loadHookSettings(config));
  const engine = createHookEngine({ hooks, config, runners });
  const support = createSupport(ctx);
  if (typeof ctx.effect === 'function') {
    // A hook that is still running when the plugin unloads finishes first.
    ctx.effect(() => () => support.drain(), 'dsh-claude-compat: drain hook runs');
  }
  registerToolHooks(ctx, engine, support);
  registerSessionHooks(ctx, engine, support);
  registerPermissionHooks(ctx, engine, support);
  registerTaskHooks(ctx, engine, support);
  const messages = registerMessageHooks(ctx, engine, support);
  registerAgentHooks(ctx, engine, support, messages);
  registerNotificationHooks(ctx, engine, support);
  return engine;
}
