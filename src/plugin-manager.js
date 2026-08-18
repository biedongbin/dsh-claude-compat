// dsh-claude-compat: /plugin management skill (v0.6.0).
//
// Full Claude-Code-equivalent plugin management surfaced as a user-invocable
// DSH skill named "plugin". Execution engine: claude CLI first (`claude
// plugin ...`, present on PATH in most Claude Code setups), self-implemented
// JSON+git fallback when the CLI is unavailable. All state lives in the
// Claude-native locations (~/.claude/plugins/*, settings.json enabledPlugins)
// so both Claude Code and this plugin's discovery bridge read the same truth.
//
// Commands (mirroring `claude plugin` semantics):
//   /plugin                                  — list installed (status incl. enabled/disabled)
//   /plugin <name>[@market]                  — one-shot install
//   /plugin install <name>[@market]
//   /plugin uninstall|remove <name>
//   /plugin enable <name>
//   /plugin disable <name>
//   /plugin update [name]                    — one or all
//   /plugin search <term>                    — scan known marketplaces
//   /plugin marketplace list|add|remove|update [...]
//
// Safety: never mutates installed_plugins.json / known_marketplaces.json /
// settings.json directly without a timestamped backup beside the file; the
// claude-CLI path performs no direct mutation at all (CLI owns the writes).

import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync, cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const HELP = `# Claude Code Plugin Manager (dsh-claude-compat)

Manage Claude Code plugins and marketplaces. State is stored in Claude-native
locations (~/.claude/plugins, ~/.claude/settings.json enabledPlugins), so
Claude Code and DSH see the same plugins. Newly installed plugin content
appears in the DSH skill catalog on next reconcile (MCP servers need a DSH restart).

## Commands
- \`/plugin\` — list installed plugins with enable/disable status
- \`/plugin <name>[@marketplace]\` — one-shot install (e.g. \`/plugin ralph@omc\`)
- \`/plugin install <name>[@marketplace]\`
- \`/plugin uninstall <name>\` (alias: remove)
- \`/plugin enable <name>\` / \`/plugin disable <name>\`
- \`/plugin update [name]\` — update one plugin or all
- \`/plugin search <term>\` — search all known marketplaces
- \`/plugin marketplace list\`
- \`/plugin marketplace add <github-repo-or-url>\`
- \`/plugin marketplace remove <name>\`
- \`/plugin marketplace update [name]\`

## Execution
Prefers the \`claude plugin\` CLI when available; falls back to direct
JSON/git manipulation (with automatic timestamped backups of every file it
touches). Report which engine ran in the result.`;

/** Run `claude plugin ...` args; resolve {ok, stdout} or {ok:false, error}. */
async function claudePlugin(args, timeoutMs = 120_000) {
  return execFileAsync('claude', ['plugin', ...args], { timeout: timeoutMs, encoding: 'utf8' })
    .then(({ stdout }) => ({ ok: true, stdout: stdout ?? '' }))
    .catch((error) => ({ ok: false, error: error?.message ?? String(error) }));
}

function pluginsRoot() {
  return join(homedir(), '.claude', 'plugins');
}

function backupFile(path) {
  if (!existsSync(path)) return undefined;
  const backup = `${path}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  copyFileSync(path, backup);
  return backup;
}

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return fallback; }
}

/** Pure: parse `claude plugin list` output into [{name, marketplace, version, scope, enabled}]. */
export function parsePluginList(output) {
  const plugins = [];
  const lines = String(output ?? '').split('\n');
  let current;
  for (const line of lines) {
    const entry = line.match(/^\s*❯\s*(\S+)@(\S+)\s*$/);
    if (entry) {
      if (current) plugins.push(current);
      current = { name: entry[1], marketplace: entry[2] };
      continue;
    }
    if (!current) continue;
    const version = line.match(/^\s*Version:\s*(\S+)/);
    if (version) current.version = version[1];
    const scope = line.match(/^\s*Scope:\s*(\S+)/);
    if (scope) current.scope = scope[1];
    const status = line.match(/^\s*Status:\s*(✔|✘)\s*(\S+)/);
    if (status) current.enabled = status[2] === 'enabled';
  }
  if (current) plugins.push(current);
  return plugins;
}

/** Pure: list plugin entries from installed_plugins.json + enabledPlugins map. */
export function listFromDisk(pluginsDir = pluginsRoot(), settingsPath = join(homedir(), '.claude', 'settings.json')) {
  const installed = readJson(join(pluginsDir, 'installed_plugins.json'), { version: 2, plugins: {} });
  const settings = readJson(settingsPath, {});
  const enabledMap = settings.enabledPlugins ?? {};
  const out = [];
  for (const [key, entries] of Object.entries(installed.plugins ?? {})) {
    const last = Array.isArray(entries) ? entries[entries.length - 1] : entries;
    if (!last) continue;
    const [name, marketplace] = key.split('@');
    const installedEnabled = enabledMap[key];
    out.push({
      name,
      marketplace,
      version: last.version,
      scope: last.scope,
      // enabledPlugins is authoritative when the key exists; default enabled.
      enabled: installedEnabled === undefined ? true : Boolean(installedEnabled),
    });
  }
  return out;
}

/** Pure: search marketplace.json catalogs under marketplaces/ for a term. */
export function searchMarketplaces(term, pluginsDir = pluginsRoot()) {
  const marketRoot = join(pluginsDir, 'marketplaces');
  const needle = String(term ?? '').toLowerCase();
  const hits = [];
  let dirs = [];
  try { dirs = readdirSync(marketRoot, { withFileTypes: true }); } catch { return hits; }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const manifest = join(marketRoot, dir.name, '.claude-plugin', 'marketplace.json');
    if (!existsSync(manifest)) continue;
    const json = readJson(manifest, null);
    for (const plugin of json?.plugins ?? []) {
      const haystack = `${plugin.name} ${plugin.description ?? ''} ${(plugin.tags ?? []).join(' ')}`.toLowerCase();
      if (needle === '' || haystack.includes(needle)) {
        hits.push({
          name: plugin.name,
          marketplace: dir.name,
          description: plugin.description ?? '',
          version: plugin.version,
          installId: `${plugin.name}@${dir.name}`,
        });
      }
    }
  }
  return hits;
}

/**
 * Fallback install for no-CLI environments: clone the marketplace repo is
 * already present under marketplaces/<name>; copy plugin source into cache and
 * register in installed_plugins.json + enabledPlugins.
 */
export async function fallbackInstall(installId, pluginsDir = pluginsRoot(), settingsPath = join(homedir(), '.claude', 'settings.json')) {
  const [pluginName, marketName] = String(installId).split('@');
  if (!marketName) return { ok: false, error: 'fallback install needs name@marketplace (marketplace repo must already be cloned)' };
  const marketJson = join(pluginsDir, 'marketplaces', marketName, '.claude-plugin', 'marketplace.json');
  const catalog = readJson(marketJson, null);
  const entry = (catalog?.plugins ?? []).find((p) => p.name === pluginName);
  if (!entry) return { ok: false, error: `plugin "${pluginName}" not found in marketplace "${marketName}"` };
  const version = entry.version ?? 'unknown';
  const sourceRel = String(entry.source ?? './').replace(/^\.\//, '');
  const from = join(pluginsDir, 'marketplaces', marketName, sourceRel);
  if (!existsSync(from)) return { ok: false, error: `plugin source missing in marketplace clone: ${sourceRel}` };
  const dest = join(pluginsDir, 'cache', marketName, pluginName, version);
  mkdirSync(dest, { recursive: true });
  cpSync(from, dest, { recursive: true });
  const installedPath = join(pluginsDir, 'installed_plugins.json');
  backupFile(installedPath);
  const installed = readJson(installedPath, { version: 2, plugins: {} });
  const key = `${pluginName}@${marketName}`;
  installed.plugins[key] = installed.plugins[key] ?? [];
  installed.plugins[key].push({
    scope: 'user',
    installPath: dest,
    version,
    installedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  });
  writeFileSync(installedPath, JSON.stringify(installed, null, 2) + '\n');
  backupFile(settingsPath);
  const settings = readJson(settingsPath, {});
  settings.enabledPlugins = settings.enabledPlugins ?? {};
  settings.enabledPlugins[key] = true;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return { ok: true, engine: 'fallback', installPath: dest, version };
}

/** Fallback enable/disable: flip enabledPlugins in settings.json (backed up). */
export function fallbackToggle(pluginRef, enable, pluginsDir = pluginsRoot(), settingsPath = join(homedir(), '.claude', 'settings.json')) {
  const installed = readJson(join(pluginsDir, 'installed_plugins.json'), { plugins: {} });
  const keys = Object.keys(installed.plugins ?? {});
  const key = keys.find((k) => k === pluginRef || k.startsWith(`${pluginRef}@`));
  if (!key) return { ok: false, error: `plugin not found: ${pluginRef}` };
  backupFile(settingsPath);
  const settings = readJson(settingsPath, {});
  settings.enabledPlugins = settings.enabledPlugins ?? {};
  settings.enabledPlugins[key] = Boolean(enable);
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return { ok: true, engine: 'fallback', key, enabled: Boolean(enable) };
}

/**
 * Main dispatcher. Input: the raw argument string after "/plugin".
 * Returns markdown text for the model to present.
 */
export async function runPluginCommand(input, deps = {}) {
  const claudeFn = deps.claude ?? claudePlugin;
  const args = String(input ?? '').trim().split(/\s+/).filter(Boolean);
  if (args.length === 0 || args[0] === 'help') return HELP;

  const [cmd, ...rest] = args;

  // `/plugin <name>[@market]` one-shot install.
  const isOneShot = !['install', 'uninstall', 'remove', 'enable', 'disable',
    'update', 'search', 'marketplace', 'list'].includes(cmd);
  if (isOneShot) return doInstall(cmd, claudeFn);

  if (cmd === 'list') {
    const res = await claudeFn(['list']);
    if (res.ok) {
      const parsed = parsePluginList(res.stdout);
      if (parsed.length === 0) return 'No plugins installed.';
      return ['Installed plugins:', '',
        ...parsed.map((p) => `- **${p.name}@${p.marketplace}** v${p.version} [${p.scope}] ${p.enabled ? '✔ enabled' : '✘ disabled'}`),
        '', 'Enable/disable with `/plugin enable|disable <name>`; install with `/plugin <name>@<marketplace>`.'].join('\n');
    }
    const parsed = listFromDisk();
    if (parsed.length === 0) return 'No plugins installed (CLI unavailable, disk scan found none).';
    return ['Installed plugins (disk scan; claude CLI unavailable):', '',
      ...parsed.map((p) => `- **${p.name}@${p.marketplace}** v${p.version} [${p.scope}] ${p.enabled ? '✔ enabled' : '✘ disabled'}`)].join('\n');
  }

  if (cmd === 'search') {
    if (rest.length === 0) return 'Usage: `/plugin search <term>`';
    const hits = searchMarketplaces(rest.join(' '));
    if (hits.length === 0) return `No marketplace plugin matches "${rest.join(' ')}".`;
    return [`Marketplace matches for "${rest.join(' ')}":`, '',
      ...hits.slice(0, 30).map((h) => `- **${h.installId}** v${h.version ?? '?'} — ${h.description.slice(0, 100)}`),
      '', 'Install with `/plugin <name>@<marketplace>`.'].join('\n');
  }

  if (cmd === 'marketplace') {
    const [sub, ...mrest] = rest;
    const subArgs = { list: ['marketplace', 'list'], add: ['marketplace', 'add', ...mrest], remove: ['marketplace', 'remove', ...mrest], rm: ['marketplace', 'remove', ...mrest], update: ['marketplace', 'update', ...mrest] }[sub];
    if (!subArgs) return 'Usage: `/plugin marketplace list|add|remove|update [...]`';
    const res = await claudeFn(subArgs, 300_000);
    if (res.ok) return `Marketplace ${sub} OK (engine: claude CLI):\n\n${res.stdout.trim()}`;
    return `Marketplace ${sub} failed. Engine: claude CLI (unavailable or errored).\n\n${res.error}\n\nFallback for marketplace mutation is not implemented (manual: git clone into ~/.claude/plugins/marketplaces/<name> and register in known_marketplaces.json).`;
  }

  const passThrough = {
    install: ['install', ...rest],
    uninstall: ['uninstall', ...rest],
    remove: ['uninstall', ...rest],
    enable: ['enable', ...rest],
    disable: ['disable', ...rest],
  }[cmd];

  if (cmd === 'update') {
    const res = await claudeFn(['update', ...rest], 300_000);
    if (res.ok) return `Update OK (engine: claude CLI):\n\n${res.stdout.trim()}\n\nRestart DSH to apply MCP changes; skills refresh automatically.`;
    return `Update failed (engine: claude CLI):\n\n${res.error}`;
  }

  if (passThrough) {
    if (passThrough[0] === 'install') return doInstall(rest.join(' '), claudeFn);
    const res = await claudeFn(passThrough, 300_000);
    if (res.ok) return `\`${cmd} ${rest.join(' ')}\` OK (engine: claude CLI):\n\n${res.stdout.trim()}`;
    if ((cmd === 'enable' || cmd === 'disable') && /ENOENT|not found|spawn/i.test(res.error)) {
      const fb = fallbackToggle(rest[0], cmd === 'enable');
      if (fb.ok) return `\`${cmd} ${rest[0]}\` OK (engine: fallback, settings.json backed up): ${fb.key} → ${fb.enabled ? 'enabled' : 'disabled'}`;
      return `Both engines failed:\n- claude CLI: ${res.error}\n- fallback: ${fb.error}`;
    }
    return `\`${cmd} ${rest.join(' ')}\` failed (engine: claude CLI):\n\n${res.error}`;
  }

  return HELP;
}

async function doInstall(installId, claudeFn) {
  if (!installId) return 'Usage: `/plugin <name>[@marketplace]`';
  const res = await claudeFn(['install', installId], 300_000);
  if (res.ok) {
    return [`Installed **${installId}** (engine: claude CLI).`, '', res.stdout.trim(),
      '', 'Skills/commands appear in the catalog on next reconcile; restart DSH if the plugin ships MCP servers.'].join('\n');
  }
  const fb = await fallbackInstall(installId);
  if (fb.ok) {
    return [`Installed **${installId}** (engine: fallback; installed_plugins.json + settings.json backed up).`,
      '', `installPath: ${fb.installPath}`, '',
      'Skills/commands appear in the catalog on next reconcile; restart DSH if the plugin ships MCP servers.'].join('\n');
  }
  return [`Install failed for **${installId}**:`, '', `- claude CLI: ${res.error}`, `- fallback: ${fb.error}`].join('\n');
}

export const PLUGIN_SKILL_NAME = 'plugin';
export const PLUGIN_SKILL_BODY = HELP;
