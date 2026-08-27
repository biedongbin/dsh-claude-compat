#!/usr/bin/env node
// cc-export.mjs — export DSH-native skills (.dsh/skills) into Claude Code
// .claude/skills format, closing the loop: DSH → Claude Code.
//
//   node cc-export.mjs list                     [--cwd <dir>]
//   node cc-export.mjs export [--cwd <dir>]     [--target <dir>] [--overwrite]
//
// "list" prints one line per DSH skill found under <projectRoot>/.dsh/skills.
//
// "export" rewrites each DSH skill into <projectRoot>/.claude/skills/<name>/SKILL.md
// (Claude Code convention: one directory per skill, containing SKILL.md with
// YAML frontmatter name/description and the markdown body). DSH skill names are
// already kebab-case, which is valid for Claude Code too. Existing files are
// skipped unless --overwrite.
//
// DSH .dsh/skills layout mirrors the filesystem provider: <name>/SKILL.md under
// the .dsh/skills root. Frontmatter is the same YAML dialect as Claude Code
// (name, description, whenToUse), so a DSH skill round-trips with no body edit.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findProjectRootSync, parseFrontmatter, stringField } from '../src/lib.js';

// ---- helpers ---------------------------------------------------------------

function walkSkills(root) {
  // Returns [{ name, dir, file }] for every SKILL.md directly under root/<name>/.
  const out = [];
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const file = join(root, e.name, 'SKILL.md');
    if (!existsSync(file)) continue;
    out.push({ name: e.name, dir: join(root, e.name), file });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// YAML value emitter: multiline strings become literal blocks (readable),
// everything else is double-quoted. Multiline frontmatter is otherwise escaped
// into a single `\n`-quoted line, which parses but loses readability.
function yamlValue(v) {
  if (typeof v === 'string' && v.includes('\n')) {
    return `|-\n${v.split('\n').map((l) => `  ${l}`).join('\n')}`;
  }
  return JSON.stringify(v);
}

function dshSkillsDir(cwd, markers) {
  const root = findProjectRootSync(cwd, markers);
  if (root === undefined) return { root: undefined, dir: undefined };
  return { root, dir: join(root, '.dsh', 'skills') };
}

function claudeSkillsDir(root) {
  return join(root, '.claude', 'skills');
}

// ---- CLI -------------------------------------------------------------------

const invokedDirectly = process.argv[1]?.endsWith('cc-export.mjs') ?? false;
if (invokedDirectly) {
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const cwd = flag('cwd') ?? process.cwd();
const markers = ['.git'];

if (cmd === 'list') {
  const { root, dir } = dshSkillsDir(cwd, markers);
  if (root === undefined) { console.log('No project root found (no .git)'); process.exit(0); }
  const skills = walkSkills(dir);
  if (skills.length === 0) { console.log(`No DSH skills in ${dir}`); process.exit(0); }
  for (const s of skills) console.log(`${s.name}\t${relative(root, s.file)}`);
  console.log(`\n${skills.length} skill(s). Export with: node cc-export.mjs export --cwd ${cwd}`);
} else if (cmd === 'export') {
  const { root, dir } = dshSkillsDir(cwd, markers);
  if (root === undefined) { console.error('No project root found (no .git)'); process.exit(1); }
  const skills = walkSkills(dir);
  if (skills.length === 0) { console.log(`No DSH skills to export in ${dir}`); process.exit(0); }
  const overwrite = flag('overwrite') !== undefined;
  const targetBase = flag('target') ?? claudeSkillsDir(root);
  let written = 0, skipped = 0, failed = 0;
  for (const s of skills) {
    const raw = readFileSync(s.file, 'utf8');
    const parsed = parseFrontmatter(raw);
    // Preserve original frontmatter keys; ensure name/description present for
    // Claude Code. Body-only files get a synthesized frontmatter.
    const data = parsed?.data ?? {};
    const body = parsed?.body ?? raw.trim();
    const name = stringField(data, 'name') ?? s.name;
    const description = stringField(data, 'description')
      ?? `Imported from DSH skill "${s.name}"`;
    const fm = { ...data, name, description };
    if (!data.whenToUse) fm.whenToUse = 'Exported from DSH via cc-export.';
    const yaml = Object.entries(fm)
      .map(([k, v]) => `${k}: ${yamlValue(v)}`)
      .join('\n');
    const targetDir = join(targetBase, s.name);
    const targetFile = join(targetDir, 'SKILL.md');
    if (existsSync(targetFile) && overwrite === false) {
      console.log(`skip (exists, no --overwrite): ${targetFile}`);
      skipped += 1;
      continue;
    }
    try {
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(targetFile, `---\n${yaml}\n---\n\n${body}\n`);
      written += 1;
    } catch (error) {
      console.error(`fail: ${targetFile} — ${error?.message ?? error}`);
      failed += 1;
    }
  }
  console.log(`exported ${written} skill(s), skipped ${skipped}, failed ${failed} → ${targetBase}`);
  if (written > 0) console.log('Claude Code will pick them up under .claude/skills/ — restart Claude Code or reload.');
} else {
  console.error('usage: cc-export.mjs list|export [--cwd dir] [--target dir] [--overwrite]');
  process.exit(2);
}
}
