// Shared helpers for dsh-claude-compat (path resolution, sync/async root
// discovery, reader utilities, frontmatter parsing). Extracted from index.js
// so mcp.js / hooks.js / agents.js can reuse them without circular imports.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
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

// Claude Code names a project folder after the working directory, unless
// CLAUDE_CODE_PROJECT_DIR_NAME overrides the name. The name is one path segment.
export function claudeProjectsDir(cwd) {
  const name = process.env.CLAUDE_CODE_PROJECT_DIR_NAME;
  if (name && (name === '.' || name === '..' || basename(name) !== name)) {
    throw new Error(
      `CLAUDE_CODE_PROJECT_DIR_NAME must be one folder name, got "${name}". Remove any "/" or "..".`,
    );
  }
  return join(resolveUserClaudeDir(), 'projects', name || cwd.replaceAll('/', '-'));
}

// Read every location variable once so a bad value fails at startup with one
// clear message, not later inside a catalog read.
export function validateClaudeLocationEnv() {
  resolveUserClaudeDir();
  resolveClaudePluginsRoot();
  claudeProjectsDir(process.cwd());
  envPathList('CLAUDE_CODE_PLUGIN_SEED_DIR');
  envPathList('CLAUDE_CODE_PLUGIN_DIRS');
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