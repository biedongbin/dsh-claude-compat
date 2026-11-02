// Read the files that hold MCP server entries, and pick the entries that win.
// Precedence, highest first: managed-mcp.json, managedMcpServers, local
// (.claude.json per project), project (.mcp.json), user (.claude.json). A name
// that appears in a higher source hides the same name below it.
//
// A file that cannot be read is never silent. Its warning says what stays off.
// A broken managed file fails closed: managed-mcp.json keeps the other sources
// off, and managed-settings.json keeps every server off.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { claudeJsonPath, docValue, isObject, managedClaudeDir, resolveUserClaudeDir } from './lib.js';

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
  if (!isObject(value)) return { error: `${path}: root must be an object` };
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

// What each unreadable file takes away. Managed files are handled in selectEntries.
const CONSEQUENCE = {
  claudeJson: 'user and local MCP servers, and the per-project disabled lists, are not read',
  projectMcp: 'project MCP servers are not read',
  userSettings: 'its allowlist, denylist and disabled lists are not applied',
  projectSettings: 'its allowlist, denylist and disabled lists are not applied',
  localSettings: 'its allowlist, denylist and disabled lists are not applied',
};

function readErrorWarnings(docs) {
  return Object.entries(CONSEQUENCE)
    .filter(([key]) => docs[key]?.error !== undefined)
    .map(([key]) => `${docs[key].error}. Consequence: ${CONSEQUENCE[key]}.`);
}

function pushScope(entries, scope, map) {
  if (!isObject(map)) return;
  for (const [name, raw] of Object.entries(map)) entries.push({ name, scope, raw });
}

// The names a settings list turns off, read from every settings file.
function projectOffNames(docs) {
  const names = new Set();
  for (const doc of [docs.managedSettings, docs.userSettings, docs.projectSettings, docs.localSettings]) {
    const list = docValue(doc).disabledMcpjsonServers;
    if (Array.isArray(list)) for (const name of list) names.add(name);
  }
  return names;
}

// The `.claude.json` list for this project. Claude Code's `disabledMcpServers`
// covers user and managed servers only.
function optOutNames(docs) {
  const list = docValue(docs.claudeJson).projects?.[docs.cwd]?.disabledMcpServers;
  return new Set(Array.isArray(list) ? list : []);
}

const OPT_OUT_SCOPES = new Set(['user', 'managed-file', 'managed-settings']);

// Drop the disabled entries, then keep the first entry for each name.
function applyDisables(entries, docs) {
  const projectOff = projectOffNames(docs);
  const optOut = optOutNames(docs);
  const seen = new Set();
  const kept = [];
  for (const entry of entries) {
    const off = (entry.scope === 'project' && projectOff.has(entry.name))
      || (OPT_OUT_SCOPES.has(entry.scope) && optOut.has(entry.name));
    if (off || seen.has(entry.name)) continue;
    seen.add(entry.name);
    kept.push(entry);
  }
  return kept;
}

// The managed-mcp.json problem, or undefined. The file must hold a server map.
function managedFileProblem(doc) {
  if (doc === undefined) return undefined;
  if (doc.error !== undefined) return doc.error;
  return isObject(doc.value.mcpServers) ? undefined : 'managed-mcp.json: mcpServers must be an object';
}

// managedMcpServers is read from managed settings only. A copy elsewhere is dropped.
function misplacedKeyWarnings(docs) {
  const found = [docs.userSettings, docs.projectSettings, docs.localSettings]
    .filter((doc) => docValue(doc).managedMcpServers !== undefined);
  return found.length === 0 ? [] : ['managedMcpServers is read from managed settings only. Other copies are ignored.'];
}

// Pick the entries that load, in precedence order, and the warnings.
// A managed-mcp.json file takes exclusive control: only the file and
// managedMcpServers load. An unreadable managed-settings.json turns every server off.
export function selectEntries(docs) {
  const warns = readErrorWarnings(docs);
  if (docs.managedSettings?.error !== undefined) {
    warns.push(`${docs.managedSettings.error}. Every MCP server is off.`);
    return { entries: [], exclusive: true, warns };
  }
  const managedProblem = managedFileProblem(docs.managedMcp);
  const exclusive = docs.managedMcp !== undefined;
  if (managedProblem !== undefined) {
    warns.push(`${managedProblem}. Servers from user, project and local sources are off.`);
  }
  const entries = [];
  if (exclusive && managedProblem === undefined) pushScope(entries, 'managed-file', docs.managedMcp.value.mcpServers);
  pushScope(entries, 'managed-settings', docValue(docs.managedSettings).managedMcpServers);
  if (!exclusive) {
    pushScope(entries, 'local', docValue(docs.claudeJson).projects?.[docs.cwd]?.mcpServers);
    pushScope(entries, 'project', docValue(docs.projectMcp).mcpServers);
    pushScope(entries, 'user', docValue(docs.claudeJson).mcpServers);
  }
  warns.push(...misplacedKeyWarnings(docs));
  return { entries: applyDisables(entries, docs), exclusive, warns };
}
