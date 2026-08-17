// Shared helpers for dsh-claude-compat (path resolution, sync/async root
// discovery, reader utilities, frontmatter parsing). Extracted from index.js
// so mcp.js / hooks.js / agents.js can reuse them without circular imports.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parse } from 'yaml';

export function resolveUserClaudeDir(dir) {
  if (dir === undefined || dir === null || dir === '') return join(homedir(), '.claude');
  if (dir === '~') return homedir();
  if (dir.startsWith('~/')) return join(homedir(), dir.slice(2));
  return resolve(dir);
}

export async function findProjectRoot(cwd, markers = ['.git']) {
  let current = resolve(cwd);
  while (true) {
    for (const marker of markers) {
      if (await pathExists(join(current, marker))) return current;
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
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
    if (parent === current) return undefined;
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