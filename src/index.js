// dsh-claude-compat — bridge Claude Code's .claude/ into DSH.
//
// Two contributions to the live runtime:
//   1. Skill provider on ctx.skills — scans <projectRoot>/.claude/skills/**/SKILL.md
//      and <projectRoot>/.claude/commands/*.md, surfaces them as DSH skills so the
//      `/skill-name` slash trigger, the `skill` tool, and the model-visible catalog
//      pick them up natively. Only name+description load at discovery; the body
//      loads on demand — same contract as the shipped filesystem provider.
//   2. System prompt section — injects <projectRoot>/.claude/rules/*.md as ordered
//      guidance. CLAUDE.md / AGENTS.md are already handled by dsh-agent-instructions,
//      so we do NOT re-inject them here.
//
// Skill name flattening: .claude/skills/gitnexus/gitnexus-guide/SKILL.md →
// "gitnexus-gitnexus-guide" (DSH skill names must be kebab-case; the shipped
// provider is one-level only, we recurse up to 3 and join segments with '-').
//
// Commands: .claude/commands/commit-changes.md → skill "commit-changes",
// user-invocable forced true so `/commit-changes` works in the slash menu.
//
// Rules text is re-read every system-prompt assembly (per model step), so rule
// edits take effect without a DSH restart. No file watcher — the cost of
// stat'ing a handful of small markdown files is negligible per step.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { parse } from 'yaml';
import { isSkillName } from '@deepseek-ai/dsh-skill';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

export const name = 'claude-compat';
export const inject = ['skills'];

export const Config = z.object({
  projectRootMarkers: z.array(z.string()).default(['.git']),
  // 150: between project-dsh (100) and project-agents (200). DSH-native skills
  // win over Claude skills; Claude skills win over user-level.
  skillRank: z.number().default(150),
  skillSource: z.string().default('project-claude'),
  rulesMaxBytes: z.number().default(65536),
  enableRules: z.boolean().default(true),
  enableSkills: z.boolean().default(true),
});

export function apply(ctx, config = {}) {
  if (config.enableSkills !== false) {
    ctx.skills.registerProvider((control) =>
      new ClaudeCompatSkillProvider(ctx, control, config));
  }
  if (config.enableRules !== false) {
    registerRulesSection(ctx, config);
  }
}

// ─── skill provider ──────────────────────────────────────────────────────────

class ClaudeCompatSkillProvider {
  constructor(ctx, control, config) {
    this.ctx = ctx;
    this.name = 'claude-compat';
    this.config = config;
    this.skillRank = config.skillRank ?? 150;
    this.source = config.skillSource ?? 'project-claude';
    control.signal.addEventListener('abort', () => {}, { once: true });
  }

  async list(options) {
    const cwd = options?.cwd;
    if (cwd === undefined || cwd === null) return [];
    const projectRoot = await findProjectRoot(cwd, this.config.projectRootMarkers);
    if (projectRoot === undefined) return [];
    const claudeDir = join(projectRoot, '.claude');
    if (!(await pathExists(claudeDir))) return [];

    const candidates = [];
    for (const c of await discoverSkills(join(claudeDir, 'skills'), this.name, this.source, this.skillRank)) {
      candidates.push(c);
    }
    for (const c of await discoverCommands(join(claudeDir, 'commands'), this.name, this.source, this.skillRank)) {
      candidates.push(c);
    }
    return candidates;
  }

  async get(candidate) {
    const locator = candidate.locator;
    const raw = await readTextSafe(locator.path);
    if (raw === undefined) return undefined;
    const parsed = parseFrontmatter(raw);
    const content = parsed === undefined ? raw.trim() : parsed.body.trim();
    return {
      name: candidate.name,
      description: candidate.description,
      ...(candidate.whenToUse !== undefined ? { whenToUse: candidate.whenToUse } : {}),
      invocation: candidate.invocation,
      source: candidate.source,
      provider: this.name,
      resourceBase: { kind: 'directory', path: locator.directory },
      path: locator.path,
      content,
    };
  }
}

// ─── discovery: .claude/skills (recursive, ≤3 levels) ────────────────────────

async function discoverSkills(rootDir, providerName, source, rank) {
  const out = [];
  if (!(await pathExists(rootDir))) return out;
  await walk(rootDir, '', 0);
  return out;

  async function walk(dir, prefix, depth) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' });
    } catch { return; }
    if (entries.some(e => e.isFile() && e.name === 'SKILL.md')) {
      const skillPath = join(dir, 'SKILL.md');
      const c = await parseSkillCandidateFile(skillPath, providerName, source, rank, prefix || undefined);
      if (c !== undefined) out.push(c);
      return; // bundle — don't descend
    }
    if (depth >= 3) return;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__') continue;
      const childPrefix = prefix ? `${prefix}-${entry.name}` : entry.name;
      await walk(join(dir, entry.name), childPrefix, depth + 1);
    }
  }
}

// ─── discovery: .claude/commands (flat) ──────────────────────────────────────

async function discoverCommands(rootDir, providerName, source, rank) {
  const out = [];
  if (!(await pathExists(rootDir))) return out;
  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true, encoding: 'utf8' });
  } catch { return out; }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const path = join(rootDir, entry.name);
    const stem = entry.name.slice(0, -3);
    if (!isSkillName(stem)) continue; // non-kebab names rejected by registry anyway
    const raw = await readTextSafe(path);
    if (raw === undefined) continue;
    const parsed = parseFrontmatter(raw);
    const description = parsed === undefined ? stem : (stringField(parsed.data, 'description') ?? stem);
    out.push({
      name: stem,
      description,
      invocation: { modelInvocable: true, userInvocable: true },
      provider: providerName,
      source,
      rank,
      locator: { path, directory: rootDir },
      resourceBase: { kind: 'directory', path: rootDir },
      path,
    });
  }
  return out;
}

async function parseSkillCandidateFile(path, providerName, source, rank, flatName) {
  const raw = await readTextSafe(path);
  if (raw === undefined) return undefined;
  const parsed = parseFrontmatter(raw);
  if (parsed === undefined) return undefined;
  const fmName = stringField(parsed.data, 'name');
  const description = stringField(parsed.data, 'description');
  if (description === undefined) return undefined;
  // Prefer frontmatter name when it is a valid kebab-case skill name. Some Claude
  // skills use names with ':' or other chars DSH rejects (e.g.
  // "salus:ai-robot-coding-env-check"); for those, fall back to the flattened
  // directory name, which is virtually always kebab-case.
  let name;
  if (fmName !== undefined && isSkillName(fmName)) name = fmName;
  else if (flatName !== undefined && isSkillName(flatName)) name = flatName;
  if (name === undefined) return undefined;
  let invocation;
  try { invocation = parseInvocationPolicy(parsed.data); }
  catch { invocation = { modelInvocable: true, userInvocable: true }; }
  const whenToUse = stringField(parsed.data, 'whenToUse');
  return {
    name,
    description,
    ...(whenToUse !== undefined ? { whenToUse } : {}),
    invocation,
    provider: providerName,
    source,
    rank,
    locator: { path, directory: dirname(path) },
    resourceBase: { kind: 'directory', path: dirname(path) },
    path,
  };
}

// ─── rules section ───────────────────────────────────────────────────────────

function registerRulesSection(ctx, config) {
  const maxBytes = config.rulesMaxBytes ?? 65536;
  // Cache built messages per session cwd — building reads ~13 files, and
  // pre-step fires every step.
  const cache = new Map();
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const decision = await next();
    if (decision.kind !== 'enter') return decision;
    const present = (list) => list.some((m) => m?.source?.kind === 'claude-compat');
    const alreadyInjected = present(messages)
      || present(decision.messages)
      || agent.session.surface.nodes.some((seq) => {
        const event = agent.session.events[seq];
        return event?.type === 'user/message'
          && event.data?.source?.kind === 'claude-compat';
      });
    if (alreadyInjected) return decision;
    // Session cwd, NOT process.cwd() — the DSH process may be launched from
    // anywhere (e.g. the profile dir); the workspace is per-session. Same
    // source of truth as dsh-agent-instructions.
    const cwd = agent.session.header?.cwd ?? process.cwd();
    if (!cache.has(cwd)) {
      const text = buildRulesText(cwd, config, maxBytes);
      if (text.length === 0) return decision;
      // Claude Code's mechanism (leaked source, api.ts prependUserContext):
      // rules as ONE user-role <system-reminder> message at the very front
      // of the message array. Not in system prompt.
      cache.set(cwd, createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'claude-compat', form: 'rules' },
      }));
    }
    return {
      kind: 'enter',
      messages: decision.messages.toSpliced(0, 0, cache.get(cwd)),
    };
  });
}

function buildRulesText(cwd, config, maxBytes) {
  const projectRoot = findProjectRootSync(cwd, config.projectRootMarkers);
  if (projectRoot === undefined) return '';
  const rulesDir = join(projectRoot, '.claude', 'rules');
  const files = listMdFilesSync(rulesDir);
  if (files.length === 0) return '';
  const parts = [];
  let total = 0;
  for (const f of files) {
    let raw;
    try { raw = readFileSync(f, 'utf8'); } catch { continue; }
    const basename = f.split('/').pop();
    const chunk = `## ${basename}\n\n${raw.trim()}\n`;
    if (total + chunk.length > maxBytes) break;
    parts.push(chunk);
    total += chunk.length;
  }
  if (parts.length === 0) return '';
  // Exact envelope Claude Code uses in prependUserContext (api.ts):
  // user-role <system-reminder> with "# claudeMd" framing.
  return `<system-reminder>
As you answer the user's questions, you can use the following context:
# claudeMd
${parts.join('\n')}
      </system-reminder>`;
}

function findProjectRootSync(cwd, markers = ['.git']) {
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

function listMdFilesSync(dir) {
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

// ─── helpers ─────────────────────────────────────────────────────────────────

async function findProjectRoot(cwd, markers = ['.git']) {
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

async function pathExists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function readTextSafe(path) {
  try { return await readFile(path, { encoding: 'utf8' }); }
  catch { return undefined; }
}

async function listMdFiles(dir) {
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

function parseFrontmatter(raw) {
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

function stringField(data, key) {
  const v = data[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function parseInvocationPolicy(data) {
  const miv = data['disable-model-invocation'];
  const uiv = data['user-invocable'];
  return {
    modelInvocable: !truthy(miv),
    userInvocable: uiv === undefined ? true : truthy(uiv),
  };
}

function truthy(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.toLowerCase();
    return s === 'true' || s === 'yes' || s === 'on' || s === '1';
  }
  if (typeof v === 'number') return v !== 0;
  return false;
}
