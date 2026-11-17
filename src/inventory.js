// dsh-claude-compat: inventory aggregation + per-project enable/disable state.
//
// Inventory shows discovered Claude content and declared integrations. It is
// not a runtime mount snapshot: declaration-only MCP/hook/rule rows say so.
// Skill candidates carry source, rank and disable state so registry collisions
// and the effect of per-project switches can be inspected.
//
// The per-project state file (<projectRoot>/.dsh/claude-compat-state.json)
// records which bridge items the user switched OFF inside DSH. Missing file
// or missing entry means ENABLED — zero-config, default-all-on, and tolerant
// of hand edits. Toggling only affects DSH-side injection (skill catalog
// filtering in provider.list); it never touches Claude Code's own files.

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { link, lstat, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  findProjectRootSync,
  isObject,
  listMdFilesSync,
  readTextSafeSync,
} from './lib.js';
import { readInstalledClaudePlugins, readPluginMcpDeclarations } from './plugins.js';
import { readSourceDocs, selectEntries } from './mcp-sources.js';

export const COMPAT_STATE_VERSION = 1;

// The state file lives under the project's DSH-native root, not .claude:
// it is DSH bridge state, not the user's Claude configuration.
export function compatStatePath(projectRoot) {
  return join(projectRoot, '.dsh', 'claude-compat-state.json');
}

// { version, disabled: { [id]: true } } → { version, disabled: Set<string> }.
// Unreadable or malformed → empty state (everything enabled), never a throw:
// a broken state file must not take down the skill catalog.
export function readCompatState(projectRoot) {
  if (projectRoot === undefined) return { version: COMPAT_STATE_VERSION, disabled: new Set() };
  let raw;
  try { raw = readFileSync(compatStatePath(projectRoot), 'utf8'); } catch { raw = undefined; }
  if (raw === undefined) return { version: COMPAT_STATE_VERSION, disabled: new Set() };
  try {
    const parsed = JSON.parse(raw);
    const disabled = new Set();
    if (isObject(parsed) && isObject(parsed.disabled)) {
      for (const [id, value] of Object.entries(parsed.disabled)) {
        if (value === true && typeof id === 'string' && id.length <= 512) disabled.add(id);
      }
    }
    return { version: COMPAT_STATE_VERSION, disabled };
  } catch {
    console.warn('dsh-claude-compat: cannot parse .dsh/claude-compat-state.json; every bridge item stays enabled');
    return { version: COMPAT_STATE_VERSION, disabled: new Set() };
  }
}

// Atomic write (temp + rename) so a crash never leaves a half-written state.
// `disabled` is an id→true map: hand-editable, and toggling one id never
// rewrites the others' entries.
export async function writeCompatState(projectRoot, disabled) {
  const path = compatStatePath(projectRoot);
  await mkdir(join(projectRoot, '.dsh'), { recursive: true });
  const body = JSON.stringify({
    version: COMPAT_STATE_VERSION,
    disabled: Object.fromEntries([...disabled].sort().map((id) => [id, true])),
  }, null, 2) + '\n';
  await atomicWrite(path, body);
}

async function atomicWrite(path, body) {
  const temp = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(temp, body, { encoding: 'utf8', flag: 'wx' });
    await rename(temp, path);
  } finally {
    await unlink(temp).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

// One project state and trash manifest are shared by every item mutation.
const mutationQueues = new Map();
async function withProjectMutation(args, action) {
  const root = findProjectRootSync(args.cwd, args.config.projectRootMarkers);
  if (root === undefined) return Promise.reject(new Error('The project directory could not be resolved'));
  const key = realpathSync(root);
  const previous = mutationQueues.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(() => action(args));
  mutationQueues.set(key, pending);
  return pending.finally(() => { if (mutationQueues.get(key) === pending) mutationQueues.delete(key); });
}

// Registry-namespace item id: source and name. Candidates carry the
// 'project-claude' | 'user-claude' | 'claude-plugin' source; installed
// plugins use their own 'plugin:<name@marketplace>' namespace so a plugin
// key can never collide with a candidate name.
// Item id = source + owning plugin (when the candidate came from one) + name.
// The plugin key is REQUIRED: two different plugins routinely ship the same
// skill/command/agent name (omc and ecc both ship `architect`), and a bare
// `source:name` id made those colliding rows indistinguishable and made
// `overriddenBy` point at themselves.
// A plugin can also ship the same name as BOTH an agent file and a skill
// directory, so kind is part of the identity too.
export function candidateId(candidate, ownerKey, kind) {
  const base = ownerKey === undefined ? `${candidate.source}:${candidate.name}` : `${candidate.source}:${ownerKey}:${candidate.name}`;
  return kind === undefined ? base : `${base}#${kind}`;
}

// The kind of a discovered candidate, from its path — the same layout rule
// buildInventory uses for plugin content.
export function kindOfPath(filePath) {
  if (typeof filePath !== 'string') return undefined;
  if (/\/commands\//.test(filePath)) return 'command';
  if (/\/agents\//.test(filePath)) return 'agent';
  if (/\/skills\//.test(filePath)) return 'skill';
  return undefined;
}

// installPath (with trailing slash) → { key, name }, longest prefix wins so a
// nested plugin root cannot shadow its parent.
export function pluginPathIndex(plugins) {
  return new Map((plugins ?? [])
    .filter((plugin) => typeof plugin.installPath === 'string')
    .map((plugin) => [`${plugin.installPath}/`, { key: plugin.key, name: plugin.name }]));
}

export function ownerOfPath(index, filePath) {
  if (typeof filePath !== 'string' || index.size === 0) return undefined;
  let best;
  for (const prefix of index.keys()) {
    if (!filePath.startsWith(prefix)) continue;
    if (best === undefined || prefix.length > best.length) best = prefix;
  }
  return best === undefined ? undefined : index.get(best);
}

// Drop candidates the user switched off for this project: directly by id,
// or wholesale when their owning plugin is off. Manager skills
// (source 'claude-compat-manager') are the bridge's own controls and are
// never filtered.
export function filterCandidatesByState(candidates, cwd, config, plugins) {
  if (cwd === undefined || cwd === null || cwd === '') return candidates;
  const projectRoot = findProjectRootSync(cwd, config.projectRootMarkers);
  const { disabled } = readCompatState(projectRoot);
  if (disabled.size === 0) return candidates;
  const installed = plugins ?? readInstalledClaudePlugins(config.pluginsRoot, config.userClaudeDir);
  const index = pluginPathIndex(installed);
  const offPlugins = new Set(installed.filter((plugin) => disabled.has(`plugin:${plugin.key}`)).map((plugin) => plugin.key));
  return candidates.filter((candidate) => {
    if (candidate.source === 'claude-compat-manager') return true;
    const owner = ownerOfPath(index, candidate.path);
    if (owner !== undefined && offPlugins.has(owner.key)) return false;
    return !disabled.has(candidateId(candidate, owner?.key, candidate.compatKind ?? kindOfPath(candidate.path)));
  });
}

// Content a plugin ships that is NOT discovered as a skill candidate: MCP
// servers, hooks and rule files. Read straight from the install dir; a broken
// manifest must not fail the whole inventory, so every read is guarded.
export function pluginExtras(installPath) {
  const counts = { mcp: 0, hook: 0, rule: 0 };
  const mcpNames = [];
  const hookEvents = [];
  let manifest = {};
  const manifestRaw = readTextSafeSync(join(installPath, '.claude-plugin', 'plugin.json'));
  if (manifestRaw !== undefined) {
    try {
      const parsed = JSON.parse(manifestRaw);
      if (isObject(parsed)) manifest = parsed;
    } catch { /* a broken manifest is reported by the MCP bridge, not here */ }
  }
  try {
    const declared = readPluginMcpDeclarations(manifest, installPath);
    mcpNames.push(...declared.entries.map(([name]) => name));
    counts.mcp = mcpNames.length;
  } catch { /* MCP declarations are best-effort for display */ }
  // Hooks: Claude plugins keep them in hooks/hooks.json or inline in the manifest.
  const hooksFile = readTextSafeSync(join(installPath, 'hooks', 'hooks.json'));
  let hooks = manifest.hooks;
  if (hooksFile !== undefined) {
    try { hooks = JSON.parse(hooksFile); } catch { /* keep the manifest value */ }
  }
  if (isObject(hooks?.hooks)) hooks = hooks.hooks;
  if (isObject(hooks)) {
    const events = Object.keys(hooks);
    hookEvents.push(...events);
    counts.hook = events.length;
  }
  // Rules: no Claude convention, but a rules/ dir is the common shape.
  const ruleFiles = listMdFilesSync(join(installPath, 'rules'));
  counts.rule = ruleFiles.length;
  return { counts, mcpNames, hookEvents, ruleFiles,
    hooksPath: hooksFile === undefined ? join(installPath, '.claude-plugin', 'plugin.json') : join(installPath, 'hooks', 'hooks.json') };
}

// ─── inventory ───────────────────────────────────────────────────────────────

const KIND_ORDER = ['plugin', 'skill', 'command', 'agent', 'rule', 'hook', 'mcp'];

// Everything the bridge loads for one project directory. Sources:
//   - installed Claude plugins (including disabled ones, so the page can
//     show them and re-enable is a Claude-side concern)
//   - skills/commands/agents from project .claude, ~/.claude and plugin
//     content, through the exact discovery functions the provider uses
//   - rules files (project first, user fallback, basename dedupe — the
//     same resolution buildRulesText performs)
//   - hook files (settings.json `hooks` blocks, listed read-only)
//   - MCP declarations from read-only source selection (runtime status unverified)
// Same-name candidates across sources are resolved like the registry does
// (lower rank wins); losers carry `overriddenBy` so the UI can flag them.
export async function buildInventory({ cwd, config, managedDir }) {
  const projectRoot = findProjectRootSync(cwd, config.projectRootMarkers);
  const { disabled } = readCompatState(projectRoot);
  const items = [];

  // Plugins (enabled AND disabled — Claude-side enablement is displayed,
  // not conflated with the DSH-side switch).
  const plugins = readInstalledClaudePlugins(config.pluginsRoot, config.userClaudeDir, { includeDisabled: true });
  const pluginItems = [];
  for (const plugin of plugins) {
    const item = {
      id: `plugin:${plugin.key}`, kind: 'plugin', name: plugin.name,
      description: plugin.marketplace ? `marketplace: ${plugin.marketplace} · v${plugin.version}` : `v${plugin.version}`,
      source: 'claude-plugin', path: plugin.installPath, rank: config.pluginSkillRank ?? 750,
      toggleable: true, disabledInDsh: disabled.has(`plugin:${plugin.key}`),
      plugin: { key: plugin.key, marketplace: plugin.marketplace, version: plugin.version,
        installPath: plugin.installPath, enabledInClaude: plugin.enabled === true,
        ...(plugin.installedAt !== undefined ? { installedAt: plugin.installedAt } : {}),
        ...(plugin.lastUpdated !== undefined ? { lastUpdated: plugin.lastUpdated } : {}) },
    };
    pluginItems.push(item);
    items.push(item);
  }

  // Candidates through the provider's own discovery paths.
  const { discoverSkills, discoverCommands } = await import('./index.js');
  const { discoverAgents } = await import('./agents.js');
  const { discoverPluginContent } = await import('./plugins.js');
  // Install-path → plugin record, for attributing candidates to their plugin.
  const pluginByPath = pluginPathIndex(plugins);
  const aliasOptions = {
    aliases: (await import('./aliases.js')).normalizeAliases(config.skillAliases),
    tagOriginal: config.aliasDescriptionPrefix !== false,
  };
  const candidates = [];
  const addKind = (kind, batch) => {
    for (const candidate of batch) candidates.push({ kind, candidate });
  };
  const projectClaude = projectRoot !== undefined ? join(projectRoot, '.claude') : undefined;
  const userRoot = (await import('./lib.js')).resolveUserClaudeDir(config.userClaudeDir);
  for (const [root, source, rank] of [
    [projectClaude, config.skillSource ?? 'project-claude', config.skillRank ?? 50],
    [userRoot, config.userSkillSource ?? 'user-claude', config.userSkillRank ?? 700],
  ]) {
    if (root === undefined) continue;
    addKind('skill', await discoverSkills(join(root, 'skills'), 'claude-compat', source, rank, aliasOptions));
    addKind('command', await discoverCommands(join(root, 'commands'), 'claude-compat', source, rank, aliasOptions));
    if (config.enableAgents !== false) {
      addKind('agent', await discoverAgents(join(root, 'agents'), 'claude-compat', source, rank, aliasOptions));
    }
  }
  if (config.enablePlugins !== false) {
    const batch = await discoverPluginContent(config.pluginsRoot, 'claude-compat',
      config.pluginSkillSource ?? 'claude-plugin', config.pluginSkillRank ?? 750,
      { enableAgents: config.enableAgents, userClaudeDir: config.userClaudeDir, includeDisabled: true, ...aliasOptions });
    // Explicit discovery kind also handles manifest paths such as ./personas.
    for (const candidate of batch) {
      const kind = candidate.compatKind ?? kindOfPath(candidate.path);
      candidates.push({ kind, candidate });
    }
  }
  // Registry-style dedupe: same name, lowest rank wins. All kinds share the
  // DSH skill namespace, so a command and skill of one name also collide.
  const pluginByKey = new Map(plugins.map((plugin) => [plugin.key, plugin]));
  const candidateState = (kind, candidate) => {
    const owner = ownerOfPath(pluginByPath, candidate.path);
    return {
      disabledInDsh: disabled.has(candidateId(candidate, owner?.key, kind)),
      disabledByPlugin: owner !== undefined && disabled.has(`plugin:${owner.key}`),
      disabledInClaude: owner !== undefined && pluginByKey.get(owner.key)?.enabled !== true,
    };
  };
  const winners = new Map();
  for (const { kind, candidate } of candidates) {
    const state = candidateState(kind, candidate);
    if (state.disabledInDsh || state.disabledByPlugin || state.disabledInClaude) continue;
    const previous = winners.get(candidate.name);
    if (previous === undefined || candidate.rank < previous.candidate.rank) {
      winners.set(candidate.name, { kind, candidate });
    }
  }
  for (const { kind, candidate } of candidates) {
    const winner = winners.get(candidate.name);
    // Owning plugin for grouping in the UI: longest matching install path wins,
    // so nested plugin roots cannot shadow each other.
    const owner = ownerOfPath(pluginByPath, candidate.path);
    const id = candidateId(candidate, owner?.key, kind);
    const winnerOwner = winner === undefined ? undefined : ownerOfPath(pluginByPath, winner.candidate.path);
    const winnerOwnerKey = winnerOwner?.key;
    const winnerOwnerName = winnerOwner?.name;
    const state = candidateState(kind, candidate);
    const inactive = state.disabledInDsh || state.disabledByPlugin || state.disabledInClaude;
    items.push({
      id, kind, name: candidate.name, description: candidate.description ?? '',
      ...(candidate.whenToUse !== undefined ? { whenToUse: candidate.whenToUse } : {}),
      source: candidate.source, path: candidate.path, rank: candidate.rank,
      ...(owner !== undefined ? { pluginKey: owner.key, pluginName: owner.name } : {}),
      toggleable: !state.disabledByPlugin && !state.disabledInClaude, ...state,
      ...(state.disabledByPlugin ? { toggleBlockedReason: 'Enable the owning plugin in DSH first' }
        : state.disabledInClaude ? { toggleBlockedReason: 'Enable the owning plugin in Claude first' } : {}),
      ...(!inactive && winner !== undefined && winner.candidate !== candidate
        ? { overriddenBy: candidateId(winner.candidate, winnerOwnerKey, winner.kind),
          overriddenByName: winnerOwnerName ?? null,
          overriddenBySource: winner.candidate.source,
          overriddenByPath: winner.candidate.path ?? null,
          // What actually distinguishes the two copies. Naming only the plugin
          // said nothing when BOTH copies ship in the same plugin (omc ships
          // `ask` as a skill AND a command), which read as nonsense.
          overriddenByKind: winner.kind,
          overriddenByFile: typeof winner.candidate.path === 'string'
            ? winner.candidate.path.split('/').slice(-2).join('/') : null,
          overriddenBySamePlugin: (winnerOwner?.key ?? null) === (owner?.key ?? null),
        } : {}),
    });
  }

  // Declaration rows and plugin totals share one dataset, including disabled plugins.
  for (const item of pluginItems) {
    const extras = pluginExtras(item.plugin.installPath);
    item.mcpNames = extras.mcpNames;
    item.hookEvents = extras.hookEvents;
    const addExtra = (kind, name, path, description) => items.push({
      id: `${kind}:${item.plugin.key}:${name}`, kind, name, description,
      ...(path !== undefined ? { path } : {}),
      source: 'claude-plugin', pluginKey: item.plugin.key, pluginName: item.name,
      toggleable: false, disabledInDsh: item.disabledInDsh,
      disabledInClaude: !item.plugin.enabledInClaude, declarationOnly: true,
    });
    for (const event of extras.hookEvents) {
      addExtra('hook', event, extras.hooksPath, 'declared by plugin; plugin hooks are not injected by this bridge');
    }
    for (const file of extras.ruleFiles) {
      addExtra('rule', basename(file), file, 'declared by plugin; plugin rules are not injected by this bridge');
    }
    for (const name of extras.mcpNames) {
      const reason = config.enableMcp === false ? 'enableMcp is off'
        : config.enablePlugins === false ? 'enablePlugins is off'
        : !item.plugin.enabledInClaude ? 'plugin is disabled in Claude'
        : config.enablePluginMcp !== true ? 'enablePluginMcp is off'
        : 'startup policy and runtime status unverified';
      addExtra('mcp', name, undefined, `declared by plugin; ${reason}`);
    }
    item.provides = Object.fromEntries(KIND_ORDER.filter((kind) => kind !== 'plugin')
      .map((kind) => [kind, items.filter((row) => row.pluginKey === item.plugin.key && row.kind === kind).length]));
    item.providesTotal = Object.values(item.provides).reduce((sum, count) => sum + count, 0);
  }

  // Rules — the same project-first, basename-deduped resolution the injector
  // performs. Display-only: rules inject per session, not via the catalog.
  const seenRules = new Set();
  for (const [root, source] of [
    [projectClaude !== undefined ? join(projectClaude, 'rules') : undefined, 'project-claude'],
    [join(userRoot, 'rules'), 'user-claude'],
  ]) {
    if (root === undefined) continue;
    for (const file of listMdFilesSync(root)) {
      const basename = file.split('/').pop();
      if (seenRules.has(basename)) continue;
      seenRules.add(basename);
      items.push({ id: `rule:${source}:${basename}`, kind: 'rule', name: basename,
        description: 'injected once per session as a system-reminder',
        source, path: file, toggleable: false, disabledInDsh: false });
    }
  }

  // Hooks — settings.json `hooks` blocks, display-only in M1.
  for (const [path, source] of [
    [projectClaude !== undefined ? join(projectClaude, 'settings.json') : undefined, 'project-claude'],
    [join(userRoot, 'settings.json'), 'user-claude'],
  ]) {
    if (path === undefined) continue;
    const raw = readTextSafeSync(path);
    if (raw === undefined) continue;
    try {
      const hooks = JSON.parse(raw)?.hooks;
      if (!isObject(hooks) || Object.keys(hooks).length === 0) continue;
      const summary = Object.entries(hooks).map(([event, matchers]) => `${event} ×${Array.isArray(matchers) ? matchers.length : 1}`).join(', ');
      items.push({ id: `hook:${source}:${path}`, kind: 'hook', name: path.split('/').pop(),
        description: summary, source, path, toggleable: false, disabledInDsh: false });
    } catch { /* a malformed settings file is reported by the hook bridge */ }
  }

  // Static source selection only: the startup loader executes headersHelper.
  // Selected declarations do not prove successful translation, policy approval or mounting.
  const selected = selectEntries(await readSourceDocs({ config, cwd, projectRoot, managedDir }));
  for (const entry of selected.entries) {
    items.push({ id: `mcp:${entry.scope}:${entry.name}`, kind: 'mcp', name: entry.name,
      description: config.enableMcp === false ? 'declared; enableMcp is off'
        : 'declared in Claude configuration; startup policy and runtime status unverified',
      source: 'mcp', mcpScope: entry.scope,
      toggleable: false, disabledInDsh: false, declarationOnly: true });
  }

  const counts = Object.fromEntries(KIND_ORDER.map((kind) => [kind, 0]));
  for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  items.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
    || a.name.localeCompare(b.name));
  return { projectRoot: projectRoot ?? null, statePath: projectRoot !== undefined ? compatStatePath(projectRoot) : null,
    counts, disabledCount: [...disabled].length, items };
}

// Apply one toggle. Rebuilds the inventory to validate the id, flips the
// entry, persists, and lets the caller invalidate the skill catalog.
export function toggleInventoryItem(args) {
  return withProjectMutation(args, toggleItem);
}

async function toggleItem({ cwd, config, id, disabled }) {
  if (typeof id !== 'string' || id === '' || id.length > 512 || !id.includes(':')) {
    throw new Error('Toggle target must be an inventory item id (source:name)');
  }
  const inventory = await buildInventory({ cwd, config });
  const item = inventory.items.find((entry) => entry.id === id);
  if (item === undefined) throw new Error(`Unknown inventory item: ${id}`);
  if (item.toggleable === false) throw new Error(item.toggleBlockedReason ?? `${item.kind} items are display-only for now`);
  const state = readCompatState(inventory.projectRoot);
  if (disabled) state.disabled.add(id);
  else state.disabled.delete(id);
  await writeCompatState(inventory.projectRoot, state.disabled);
  return { ok: true, id, disabled, catalogRefreshed: true,
    text: `${item.name} is now ${disabled ? 'disabled' : 'enabled'} in DSH (skill catalog refreshed; MCP and hooks changes still need a DSH restart).` };
}

// Read one inventory item's file for the in-page viewer. The path always comes
// from the inventory itself, never from the client, so this cannot be turned
// into an arbitrary file read. Directories explain themselves instead of
// returning EISDIR.
export async function readItemContent(filePath, { maxBytes = 200_000 } = {}) {
  if (typeof filePath !== 'string' || filePath === '') throw new Error('This item has no file to read');
  let info;
  try { info = await stat(filePath); } catch { throw new Error('The file no longer exists on disk'); }
  if (info.isDirectory()) {
    throw new Error('This path is a directory (an installed plugin). Open its plugin.json or a file inside it instead.');
  }
  const raw = await readFile(filePath, 'utf8');
  const truncated = raw.length > maxBytes;
  const content = truncated ? raw.slice(0, maxBytes) : raw;
  return { ok: true, content, contentHash: createHash('sha256').update(content).digest('hex'), truncated,
    bytes: info.size, mtime: info.mtime.toISOString() };
}

// ─── trash (recycle-bin removal for file-backed items) ──────────────────────
// A trashed skill/command/agent file moves under <projectRoot>/.dsh/trash/
// with a manifest recording its original path, so Restore is exact. The item
// is ALSO marked disabled in the state file: even before the catalog refresh
// the provider filter keeps it out, and a hand-restore of the file without
// the UI leaves no stale enablement.

const trashDir = (root) => join(root, '.dsh', 'trash');
const trashManifestPath = (root) => join(trashDir(root), 'manifest.json');

function readTrashManifest(root) {
  let raw;
  try { raw = readFileSync(trashManifestPath(root), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const manifest = JSON.parse(raw);
  if (!Array.isArray(manifest) || manifest.some((entry) => !isObject(entry)
    || typeof entry.id !== 'string' || typeof entry.originalPath !== 'string' || typeof entry.trashPath !== 'string')) {
    throw new Error('Trash manifest is invalid; repair it before changing trash');
  }
  return manifest;
}

async function writeTrashManifest(root, manifest) {
  await mkdir(trashDir(root), { recursive: true });
  await atomicWrite(trashManifestPath(root), JSON.stringify(manifest, null, 2) + '\n');
}

// Trashed entries for the UI: manifest records that still exist on disk.
export function listTrashedItems({ cwd, config }) {
  const projectRoot = findProjectRootSync(cwd, config.projectRootMarkers);
  if (projectRoot === undefined) return { projectRoot, items: [] };
  const items = readTrashManifest(projectRoot)
    .filter((entry) => entry && typeof entry.originalPath === 'string' && existsSync(entry.trashPath))
    .map((entry) => ({ id: entry.id, name: entry.originalPath.split('/').pop(),
      originalPath: entry.originalPath, trashedAt: entry.at }));
  return { projectRoot, items };
}

// Move one file-backed inventory item into the trash. Plugin items refuse:
// their lifecycle belongs to `plugins.uninstall`.
export function trashInventoryItem(args) {
  return withProjectMutation(args, trashItem);
}

// link refuses an existing destination atomically; only regular files are supported.
async function moveFileWithoutOverwrite(from, to) {
  if (!(await lstat(from)).isFile()) throw new Error('Only regular files can be moved to or from trash');
  await link(from, to);
  try { await unlink(from); }
  catch (error) { await unlink(to); throw error; }
}

async function trashItem({ cwd, config, id }) {
  if (typeof id !== 'string' || !id.includes(':')) throw new Error('Trash target must be an inventory item id');
  if (id.startsWith('plugin:')) throw new Error('Plugins are removed through plugins.uninstall, not the trash');
  const projectRoot = findProjectRootSync(cwd, config.projectRootMarkers);
  if (projectRoot === undefined) throw new Error('The project directory could not be resolved');
  const manifest = readTrashManifest(projectRoot);
  if (manifest.some((entry) => entry.id === id && existsSync(entry.trashPath))) {
    throw new Error('This item is already in the trash');
  }
  const inventory = await buildInventory({ cwd, config });
  const item = inventory.items.find((entry) => entry.id === id);
  if (item === undefined) throw new Error(`Unknown inventory item: ${id}`);
  if (item.pluginKey !== undefined || !['skill', 'command', 'agent'].includes(item.kind)) {
    throw new Error('Only project or user skills, commands and agents can be trashed');
  }
  if (typeof item.path !== 'string' || !existsSync(item.path)) throw new Error(`${item.name} has no local file to move`);
  const root = projectRoot;
  const trashPath = join(trashDir(root), `${randomUUID()}-${basename(item.path)}`);
  await mkdir(trashDir(root), { recursive: true });
  await moveFileWithoutOverwrite(item.path, trashPath);
  const entry = { id, originalPath: item.path, trashPath, at: new Date().toISOString() };
  let manifestWritten = false;
  try {
    await writeTrashManifest(root, [...manifest, entry]);
    manifestWritten = true;
    const state = readCompatState(root);
    state.disabled.add(id);
    await writeCompatState(root, state.disabled);
  } catch (error) {
    try {
      await moveFileWithoutOverwrite(trashPath, item.path);
      if (manifestWritten) await writeTrashManifest(root, manifest);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], `Trash failed and rollback failed; recover the file at ${trashPath}`);
    }
    throw error;
  }
  return { ok: true, id, catalogRefreshed: true,
    text: `${item.name} was moved to the project trash and disabled. Restore it from the trash list.` };
}

// Move the newest trashed entry for an id back to its original path and
// re-enable it.
export function restoreInventoryItem(args) {
  return withProjectMutation(args, restoreItem);
}

async function restoreItem({ cwd, config, id }) {
  if (typeof id !== 'string' || !id.includes(':')) throw new Error('Restore target must be an inventory item id');
  const projectRoot = findProjectRootSync(cwd, config.projectRootMarkers);
  if (projectRoot === undefined) throw new Error('The project directory could not be resolved');
  const manifest = readTrashManifest(projectRoot);
  const index = manifest.findLastIndex((entry) => entry.id === id && existsSync(entry.trashPath));
  if (index < 0) throw new Error(`No trashed item for ${id}`);
  const entry = manifest[index];
  await mkdir(dirname(entry.originalPath), { recursive: true });
  if (existsSync(entry.originalPath)) throw new Error(`${entry.originalPath} already exists; move it away first`);
  await moveFileWithoutOverwrite(entry.trashPath, entry.originalPath);
  let manifestWritten = false;
  try {
    await writeTrashManifest(projectRoot, manifest.filter((_, at) => at !== index));
    manifestWritten = true;
    const state = readCompatState(projectRoot);
    state.disabled.delete(id);
    await writeCompatState(projectRoot, state.disabled);
  } catch (error) {
    try {
      await moveFileWithoutOverwrite(entry.originalPath, entry.trashPath);
      if (manifestWritten) await writeTrashManifest(projectRoot, manifest);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], `Restore failed and rollback failed; inspect ${entry.originalPath} and ${entry.trashPath}`);
    }
    throw error;
  }
  return { ok: true, id, catalogRefreshed: true,
    text: `${entry.originalPath.split('/').pop()} was restored and re-enabled.` };
}
