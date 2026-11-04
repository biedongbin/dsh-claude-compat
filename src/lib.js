// Shared helpers for dsh-claude-compat (path resolution, sync/async root
// discovery, reader utilities, frontmatter parsing). Extracted from index.js
// so mcp.js / hooks.js / agents.js can reuse them without circular imports.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parse } from 'yaml';

// Producer-owned source kind for every message this plugin injects. dsh's
// session format v4 admission (session-format-v3-to-v4/src/message-sources.ts)
// rejects the retired V3 `kind: 'plugin'` wrapper: a third-party producer must
// emit its own kind. dsh derives exactly this string for us — `producerKind()`
// falls through RENAMED_PRODUCERS and RELEASED_SAME_NAME_PRODUCERS to
// `plugin:${plugin}` — so a V3 log migrated by dsh and a message we emit today
// carry the identical kind. Emission and dedup must both use this constant.
export const CLAUDE_COMPAT_SOURCE_KIND = 'plugin:dsh-claude-compat';

// Claude Code copies env values as written and never expands `~`, so a
// relative value would resolve against the launch directory. Fail fast instead.
function requireAbsolute(name, value) {
  if (!isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path, got "${value}". Set it to a full path.`);
  }
  return value;
}

function envAbsolutePath(name) {
  const value = process.env[name];
  if (!value) return undefined;
  return requireAbsolute(name, value);
}

// A PATH-style list (`:` on Unix, `;` on Windows). Blank entries are dropped
// and every entry must be absolute.
export function envPathList(name) {
  const value = process.env[name];
  if (!value) return [];
  return value.split(delimiter).filter(Boolean).map((entry) => requireAbsolute(name, entry));
}

// Precedence: explicit plugin config, then CLAUDE_CONFIG_DIR, then ~/.claude.
// An explicit relative value still resolves against the launch directory.
export function resolveUserClaudeDir(dir) {
  if (dir === undefined || dir === null || dir === '') {
    return envAbsolutePath('CLAUDE_CONFIG_DIR') ?? join(homedir(), '.claude');
  }
  if (dir === '~') return homedir();
  if (dir.startsWith('~/')) return join(homedir(), dir.slice(2));
  return resolve(dir);
}

// Precedence: explicit config, then CLAUDE_CODE_PLUGIN_CACHE_DIR (the plugins
// root, not only the cache), then <user dir>/plugins. `userDir` is the explicit
// userClaudeDir config value, so a configured user dir also moves the plugins.
export function resolveClaudePluginsRoot(dir, userDir) {
  if (dir === undefined || dir === null || dir === '') {
    return envAbsolutePath('CLAUDE_CODE_PLUGIN_CACHE_DIR') ?? join(resolveUserClaudeDir(userDir), 'plugins');
  }
  return resolveUserClaudeDir(dir);
}

// Claude Code honors CLAUDE_CODE_PROJECT_DIR_NAME only together with
// CLAUDE_CONFIG_DIR, and only for 1-64 letters, digits, hyphens or underscores
// that are not a Windows device name. Any other value is ignored, not an error.
const PROJECT_DIR_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

function projectDirNameOverride() {
  const name = process.env.CLAUDE_CODE_PROJECT_DIR_NAME;
  if (!process.env.CLAUDE_CONFIG_DIR || !name) return undefined;
  if (!PROJECT_DIR_NAME.test(name) || WINDOWS_DEVICE.test(name)) return undefined;
  return name;
}

// Claude Code turns every character that is not a letter or digit into `-`. A name
// over this length is cut and gets a hash of the full path, so two long paths differ.
const MAX_PROJECT_FOLDER = 200;

// 31-multiplier string hash over UTF-16 units, as Claude Code computes it.
function pathHash(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash << 5) - hash + text.charCodeAt(i) | 0;
  return hash;
}

export function claudeProjectFolder(cwd) {
  const name = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  if (name.length <= MAX_PROJECT_FOLDER) return name;
  return `${name.slice(0, MAX_PROJECT_FOLDER)}-${Math.abs(pathHash(cwd)).toString(36)}`;
}

export function claudeProjectsDir(cwd, userDir) {
  const folder = projectDirNameOverride() ?? claudeProjectFolder(cwd);
  return join(resolveUserClaudeDir(userDir), 'projects', folder);
}

// CLAUDE_CODE_PLUGIN_DIRS: each entry is an absolute path or starts with `~`.
// Claude Code skips any other entry, so this returns the skipped ones for a warning.
export function envPluginDirs() {
  const dirs = [];
  const skipped = [];
  for (const entry of (process.env.CLAUDE_CODE_PLUGIN_DIRS ?? '').split(delimiter)) {
    if (entry === '') continue;
    if (entry === '~' || entry.startsWith('~/')) dirs.push(resolveUserClaudeDir(entry));
    else if (isAbsolute(entry)) dirs.push(entry);
    else skipped.push(entry);
  }
  return { dirs, skipped };
}

// Read the variables that the effective configuration still uses, so a bad value
// fails at startup with one clear message. An explicit config value overrides its
// variable, so a bad variable behind it is not an error.
export function validateClaudeLocationEnv({ userClaudeDir, pluginsRoot } = {}) {
  resolveUserClaudeDir(userClaudeDir);
  resolveClaudePluginsRoot(pluginsRoot, userClaudeDir);
  envPathList('CLAUDE_CODE_PLUGIN_SEED_DIR');
}

// No marker on the whole ancestor chain → fall back to cwd, matching DSH's own
// skill-filesystem root rule ("nearest ancestor containing `.git`; without one,
// the current cwd is used"). Returning undefined here silently dropped a
// non-git project's .claude/skills and .claude/rules (issue #10); Claude Code
// reads .claude/ from a plain directory just the same.
export async function findProjectRoot(cwd, markers = ['.git']) {
  let current = resolve(cwd);
  while (true) {
    for (const marker of markers) {
      if (await pathExists(join(current, marker))) return current;
    }
    const parent = dirname(current);
    if (parent === current) return resolve(cwd);
    current = parent;
  }
}

export function findProjectRootSync(cwd, markers = ['.git']) {
  let current = resolve(cwd);
  while (true) {
    for (const marker of markers) {
      if (existsSync(join(current, marker))) return current;
    }
    const parent = dirname(current);
    if (parent === current) return resolve(cwd);
    current = parent;
  }
}

export async function pathExists(path) {
  try { await stat(path); return true; } catch { return false; }
}

export async function readTextSafe(path) {
  try { return await readFile(path, { encoding: 'utf8' }); }
  catch { return undefined; }
}

export function readTextSafeSync(path) {
  try { return readFileSync(path, 'utf8'); } catch { return undefined; }
}

export async function listMdFiles(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' }); }
  catch { return []; }
  const files = [];
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.md')) files.push(join(dir, e.name));
  }
  files.sort();
  return files;
}

export function listMdFilesSync(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return []; }
  const files = [];
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    const p = join(dir, name);
    try { if (statSync(p).isFile()) files.push(p); } catch {}
  }
  files.sort();
  return files;
}

// Frontmatter: `---` line, YAML block, closing `---` line, body after. Returns
// { data, body } on success, undefined on anything malformed.
export function parseFrontmatter(raw) {
  const firstLineEnd = raw.indexOf('\n');
  if (firstLineEnd < 0) return undefined;
  if (raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') return undefined;
  const start = firstLineEnd + 1;
  const closing = findClosingFrontmatter(raw, start);
  if (closing === undefined) return undefined;
  let parsed;
  try { parsed = parse(raw.slice(start, closing.start)); }
  catch { return undefined; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  return { data: parsed, body: raw.slice(closing.bodyStart) };
}

export function stringField(data, key) {
  const v = data[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function truthy(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.toLowerCase();
    return s === 'true' || s === 'yes' || s === 'on' || s === '1';
  }
  if (typeof v === 'number') return v !== 0;
  return false;
}

function findClosingFrontmatter(raw, start) {
  let lineStart = start;
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart);
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline;
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
      return { start: lineStart, bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1 };
    }
    if (nextNewline < 0) return undefined;
    lineStart = nextNewline + 1;
  }
  return undefined;
}