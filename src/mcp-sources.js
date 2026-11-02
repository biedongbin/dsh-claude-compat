// Read the files that hold MCP server entries, and pick the entries that win.
// Precedence, highest first: managed-mcp.json, managedMcpServers, local
// (.claude.json per project), project (.mcp.json), user (.claude.json). A name
// that appears in a higher source hides the same name below it.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { claudeJsonPath, managedClaudeDir, resolveUserClaudeDir } from './lib.js';

// Read one JSON file. Missing is undefined. Unreadable or malformed is { error }.
async function readDoc(path) {
  let raw;
  try { raw = await readFile(path, 'utf8'); } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    return { error: `${path}: ${error?.message ?? error}` };
  }
  let value;
  try { value = JSON.parse(raw); } catch (error) {
    return { error: `${path}: invalid JSON (${error?.message ?? error})` };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: `${path}: root must be an object` };
  }
  return { value };
}

// Gather every document this loader can read. The project files need a
// project root, and the managed folder can be replaced for tests.
export async function readSourceDocs({ config, cwd, projectRoot, managedDir = managedClaudeDir() }) {
  const userDir = resolveUserClaudeDir(config.userClaudeDir);
  const docs = {
    managedMcp: await readDoc(join(managedDir, 'managed-mcp.json')),
    managedSettings: await readDoc(join(managedDir, 'managed-settings.json')),
    userSettings: await readDoc(join(userDir, 'settings.json')),
    claudeJson: await readDoc(claudeJsonPath(config.userClaudeDir)),
    cwd,
  };
  if (projectRoot !== undefined) {
    docs.projectMcp = await readDoc(join(projectRoot, '.mcp.json'));
    docs.projectSettings = await readDoc(join(projectRoot, '.claude', 'settings.json'));
    docs.localSettings = await readDoc(join(projectRoot, '.claude', 'settings.local.json'));
  }
  return docs;
}

function valueOf(doc) {
  return doc?.value ?? {};
}

function mapOf(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value;
}

function pushScope(entries, scope, map) {
  for (const [name, raw] of Object.entries(mapOf(map))) entries.push({ name, scope, raw });
}

// The names a settings list turns off, read from every settings file.
function disabledNames(docs, key) {
  const names = new Set();
  for (const doc of [docs.managedSettings, docs.userSettings, docs.projectSettings, docs.localSettings]) {
    const list = valueOf(doc)[key];
    if (Array.isArray(list)) for (const name of list) names.add(name);
  }
  return names;
}

// Entries the per-project `.claude.json` list turns off for user and managed scope.
function projectDisabled(docs) {
  const list = valueOf(docs.claudeJson).projects?.[docs.cwd]?.disabledMcpServers;
  return new Set(Array.isArray(list) ? list : []);
}

// Pick the entries that load, in precedence order. A managed-mcp.json file takes
// exclusive control: only the file and managedMcpServers load. An unreadable
// file keeps the others off, because a broken policy must not fail open.
export function selectEntries(docs) {
  const warns = [];
  const entries = [];
  const managedFile = docs.managedMcp;
  const exclusive = managedFile !== undefined;
  if (managedFile?.error !== undefined) warns.push(`managed-mcp.json unreadable, all MCP servers off: ${managedFile.error}`);
  if (managedFile?.value !== undefined) pushScope(entries, 'managed-file', managedFile.value.mcpServers);
  pushScope(entries, 'managed-settings', valueOf(docs.managedSettings).managedMcpServers);
  if (!exclusive) {
    const project = valueOf(docs.claudeJson).projects?.[docs.cwd];
    pushScope(entries, 'local', project?.mcpServers);
    pushScope(entries, 'project', valueOf(docs.projectMcp).mcpServers);
    pushScope(entries, 'user', valueOf(docs.claudeJson).mcpServers);
  }
  return { entries: applyDisables(entries, docs), exclusive, warns: warns.concat(misplacedKeys(docs)) };
}

// managedMcpServers is read from managed settings only. A copy elsewhere is dropped.
function misplacedKeys(docs) {
  const found = [docs.userSettings, docs.projectSettings, docs.localSettings]
    .filter((doc) => valueOf(doc).managedMcpServers !== undefined);
  return found.length === 0 ? [] : ['managedMcpServers is read from managed settings only, other copies are ignored'];
}

// Claude Code's `disabledMcpServers` covers user and managed servers only.
const PROJECT_OPT_OUT_SCOPES = new Set(['user', 'managed-file', 'managed-settings']);

// Drop the disabled entries, then keep the first entry for each name.
function applyDisables(entries, docs) {
  const projectOff = disabledNames(docs, 'disabledMcpjsonServers');
  const optOut = projectDisabled(docs);
  const seen = new Set();
  const kept = [];
  for (const entry of entries) {
    const off = (entry.scope === 'project' && projectOff.has(entry.name))
      || (PROJECT_OPT_OUT_SCOPES.has(entry.scope) && optOut.has(entry.name));
    if (off || seen.has(entry.name)) continue;
    seen.add(entry.name);
    kept.push(entry);
  }
  return kept;
}
