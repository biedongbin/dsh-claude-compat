// dsh-claude-compat: installed Claude Code plugins (~/.claude/plugins).
//
// Claude Code's plugin-marketplace installs plugins into
// <pluginsRoot>/cache/<marketplace>/<name>/<version>/ and records them in
// <pluginsRoot>/installed_plugins.json. Each install root carries a
// .claude-plugin/plugin.json manifest listing skills dirs / commands dir /
// agents dir / an .mcp.json. We surface skills/commands/agents as DSH skill
// candidates at pluginSkillRank (default 750 — the long tail, below
// user-claude 700 and bundled 600), keeping original names; existing dedupe
// resolves collisions. Plugin MCP servers mount only when enablePluginMcp is
// opted in (mounting third-party MCP servers is a bigger trust step than
// listing skills).

import { readFileSync as rfs } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  pathExists,
  readTextSafe,
  resolveUserClaudeDir,
  parseFrontmatter,
  stringField,
} from './lib.js';
import { translateMcpServers } from './mcp.js';

// Parse installed_plugins.json → [{ key, name, marketplace, installPath,
// version }] for scope==='user' entries. Dedupe per key, keeping the last
// entry (Claude Code appends reinstall records; last is freshest).
export function readInstalledClaudePlugins(pluginsRoot) {
  const root = resolveUserClaudeDir(pluginsRoot === undefined ? '~/.claude/plugins' : pluginsRoot);
  const manifestPath = join(root, 'installed_plugins.json');
  let parsed;
  try { parsed = JSON.parse(claReadSync(manifestPath)); }
  catch { return []; }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const plugins = parsed.plugins;
  if (typeof plugins !== 'object' || plugins === null || Array.isArray(plugins)) return [];
  const byKey = new Map();
  for (const [key, entries] of Object.entries(plugins)) {
    if (!Array.isArray(entries)) continue;
    const record = entries.findLast((e) => e?.scope === 'user');
    if (record === undefined || typeof record.installPath !== 'string') continue;
    const at = key.lastIndexOf('@');
    byKey.set(key, {
      key,
      name: at > 0 ? key.slice(0, at) : key,
      marketplace: at > 0 ? key.slice(at + 1) : '',
      installPath: record.installPath,
      version: typeof record.version === 'string' ? record.version : 'unknown',
    });
  }
  return [...byKey.values()];
}

// readFileSync kept local so readInstalledClaudePlugins stays sync-simple.
function claReadSync(p) { return rfs(p, 'utf8'); }

// Discover skill/command/agent candidates from all installed plugins. When a
// plugin has a .claude-plugin/plugin.json manifest, its listed dirs are used;
// otherwise fall back to scanning <installPath>/skills and <installPath>/commands.
// Claude Code's discoverCommands drops commands whose only description is the
// empty string; plugin marketplaces ship many such stubs, so this wrapper
// re-surfaces them with the filename stem as the description.
export async function discoverPluginContent(pluginsRoot, providerName, source, rank, { enableAgents } = {}) {
  const out = [];
  const plugins = readInstalledClaudePlugins(pluginsRoot);
  const { discoverSkills, discoverCommands } = await import('./index.js');
  const { discoverAgents } = await import('./agents.js');
  const patchedCommands = async (dir) => {
    const batch = await discoverCommands(dir, providerName, source, rank);
    if (batch.length > 0) return batch;
    const kept = new Set(batch.map((c) => c.path));
    const extra = await discoverCommandsAllowEmpty(dir, providerName, source, rank);
    return [...batch, ...extra.filter((c) => !kept.has(c.path))];
  };
  for (const plugin of plugins) {
    const { installPath } = plugin;
    const manifest = await readPluginManifest(installPath);
    // Dedupe within each KIND only: omc-style plugins ship both skills/ask and
    // commands/ask.md — same-name cross-kind pairs are surfaced separately and
    // resolved by registry dedupe (skills are emitted first, so the skill wins,
    // mirroring Claude Code's own behavior).
    const seenByKind = { skills: new Set(), commands: new Set(), agents: new Set() };
    const push = (kind) => (batch) => {
      for (const c of batch) {
        if (seenByKind[kind].has(c.name)) continue;
        seenByKind[kind].add(c.name);
        out.push(c);
      }
    };
    if (manifest !== undefined) {
      const skillDirs = manifestDirs(manifest, 'skills', installPath);
      for (const dir of skillDirs) push('skills')(await discoverSkills(dir, providerName, source, rank));
      const commandsDir = typeof manifest.commands === 'string' ? resolve(installPath, manifest.commands) : undefined;
      if (commandsDir !== undefined) push('commands')(await patchedCommands(commandsDir));
    } else {
      push('skills')(await discoverSkills(join(installPath, 'skills'), providerName, source, rank));
      push('commands')(await patchedCommands(join(installPath, 'commands')));
    }
    if (enableAgents !== false) {
      const agentsDir = join(installPath, 'agents');
      if (await pathExists(agentsDir)) push('agents')(await discoverAgents(agentsDir, providerName, source, rank));
    }
  }
  return out;
}

// Like discoverCommands but keeps empty-description stubs (stem as description).
async function discoverCommandsAllowEmpty(rootDir, providerName, source, rank) {
  const { readdir } = await import('node:fs/promises');
  const { isSkillName } = await import('@deepseek-ai/dsh-skill');
  const out = [];  if (!(await pathExists(rootDir))) return out;
  let entries;
  try { entries = await readdir(rootDir, { withFileTypes: true, encoding: 'utf8' }); }
  catch { return out; }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const stem = entry.name.slice(0, -3);
    if (!isSkillName(stem)) continue;
    const raw = await readTextSafe(join(rootDir, entry.name));
    if (raw === undefined) continue;
    const parsed = parseFrontmatter(raw);
    if (parsed === undefined) continue; // no frontmatter at all → skip (index.js variant covers body-only)
    const description = stringField(parsed.data, 'description');
    if (description !== undefined) continue; // non-empty handled by index.js variant
    out.push({
      name: stem,
      description: stem,
      invocation: { modelInvocable: true, userInvocable: true },
      provider: providerName,
      source,
      rank,
      locator: { path: join(rootDir, entry.name), directory: rootDir },
      resourceBase: { kind: 'directory', path: rootDir },
      path: join(rootDir, entry.name),
    });
  }
  return out;
}

async function readPluginManifest(installPath) {
  const raw = await readTextSafe(join(installPath, '.claude-plugin', 'plugin.json'));
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch { return undefined; }
}

function manifestDirs(manifest, field, installPath) {
  const v = manifest[field];
  if (typeof v === 'string') return [resolve(installPath, v)];
  if (Array.isArray(v)) {
    return v.filter((d) => typeof d === 'string').map((d) => resolve(installPath, d));
  }
  return [];
}

// Translate a plugin's MCP config into dsh-mcp-client server configs. Returns
// { servers, warns } (empty when no/invalid mcpServers field). Substitutes the
// ${CLAUDE_PLUGIN_ROOT} placeholder Claude Code defines for plugin processes.
export function translatePluginMcp(manifest, installPath, opts = {}) {
  const ref = manifest?.mcpServers;
  if (typeof ref !== 'string') return { servers: [], warns: [] };
  const raw = readTextSafeSync(resolve(installPath, ref));
  if (raw === undefined) return { servers: [], warns: [`mcpServers file not readable: ${ref}`] };
  const substituted = raw.replaceAll('${CLAUDE_PLUGIN_ROOT}', installPath);
  return translateMcpServers(substituted, opts);
}

function readTextSafeSync(p) { try { return rfs(p, 'utf8'); } catch { return undefined; } }
