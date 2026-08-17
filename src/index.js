// dsh-claude-compat — bridge Claude Code's .claude/ into DSH.
//
// Contributions to the live runtime:
//   1. Skill provider on ctx.skills — scans <projectRoot>/.claude/skills/**/SKILL.md,
//      <projectRoot>/.claude/commands/*.md and <projectRoot>/.claude/agents/*.md
//      (plus the user-level ~/.claude equivalents), surfaces them as DSH skills
//      so the `/skill-name` slash trigger, the `skill` tool, and the
//      model-visible catalog pick them up natively. Only name+description load
//      at discovery; the body loads on demand — same contract as the shipped
//      filesystem provider. Agents are a delegation shim: DSH has no markdown
//      subagent format, so each agent file becomes a skill whose body leads
//      with an explicit "delegate with this persona" instruction.
//   2. Rules message-stream injection — injects <projectRoot>/.claude/rules/*.md
//      and ~/.claude/rules/*.md as ONE user-role <system-reminder> message
//      prepended at the front of the message array, once per session
//      (agent/pre-step). This mirrors Claude Code's prependUserContext channel,
//      which models follow reliably. Same-name rule files are deduped,
//      project .claude winning over ~/.claude.
//      CLAUDE.md / AGENTS.md are already handled by dsh-agent-instructions,
//      so we do NOT re-inject them here.
//   3. Hooks (Claude Code subset PreToolUse/PostToolUse/UserPromptSubmit) from
//      .claude/settings.json — bridged onto tools/pre-execute,
//      tools/post-execute and agent/pre-step (see src/hooks.js).
//   4. MCP servers from <projectRoot>/.mcp.json — mounted as dsh-mcp-client
//      plugin instances at startup from the launch workspace (see src/mcp.js).
//
// Skill name flattening: .claude/skills/gitnexus/gitnexus-guide/SKILL.md →
// "gitnexus-gitnexus-guide" (DSH skill names must be kebab-case; the shipped
// provider is one-level only, we recurse up to 3 and join segments with '-').
//
// Commands: .claude/commands/commit-changes.md → skill "commit-changes",
// user-invocable forced true so `/commit-changes` works in the slash menu.
//
// Precedence (DSH registry semantics: candidates sort by rank ascending and
// duplicate skill names are first-wins — LOWER rank wins). The native ladder
// is project-dsh 100, project-agents 200, custom 300, user-dsh 400,
// user-agents 500, DSH bundled 600 (fixed BUNDLED_SKILL_RANK). This plugin
// emits project .claude at rank 50 and ~/.claude at rank 700, so conflicts
// resolve as: project .claude > DSH native (600) > ~/.claude.
//
// Rules are read once per session (cached per session cwd, from
// agent.session.header.cwd — NOT process.cwd(), the DSH process may be
// launched from anywhere). Editing a rule mid-session takes effect in the
// next session.

import { readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { isSkillName } from '@deepseek-ai/dsh-skill';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { discoverAgents, renderAgentContent } from './agents.js';
import { registerHooks } from './hooks.js';
import { mountMcpServers } from './mcp.js';
import {
  findProjectRoot,
  findProjectRootSync,
  listMdFilesSync,
  parseFrontmatter,
  readTextSafe,
  resolveUserClaudeDir,
  stringField,
} from './lib.js';

export const name = 'claude-compat';
export const inject = ['skills'];

export const Config = z.object({
  projectRootMarkers: z.array(z.string()).default(['.git']),
  // DSH dedupes by rank ascending (lower wins). 50 beats the DSH-native
  // project roots (100/200) and the bundled root (600) — project .claude wins
  // every collision. 700 loses to bundled 600 — DSH native wins over
  // ~/.claude. Final priority: project .claude > DSH native > ~/.claude.
  skillRank: z.number().default(50),
  skillSource: z.string().default('project-claude'),
  userSkillRank: z.number().default(700),
  userSkillSource: z.string().default('user-claude'),
  userClaudeDir: z.string().default('~/.claude'),
  rulesMaxBytes: z.number().default(65536),
  userRulesMaxBytes: z.number().default(65536),
  enableRules: z.boolean().default(true),
  enableSkills: z.boolean().default(true),
  enableMcp: z.boolean().default(true),
  mcpFailOnStartupError: z.boolean().default(false),
  enableHooks: z.boolean().default(true),
  hooksTimeoutMs: z.number().default(60000),
  enableAgents: z.boolean().default(true),
});

export function apply(ctx, config = {}) {
  if (config.enableSkills !== false) {
    ctx.skills.registerProvider((control) =>
      new ClaudeCompatSkillProvider(ctx, control, config));
  }
  if (config.enableRules !== false) {
    registerRulesSection(ctx, config);
  }
  if (config.enableHooks !== false) {
    registerHooks(ctx, config);
  }
  if (config.enableMcp !== false) {
    // Process-lifetime mount — deliberately NOT session-scoped (see src/mcp.js).
    mountMcpServers(ctx, config).catch((error) => {
      console.warn('dsh-claude-compat: MCP mount failed:', error?.message ?? error);
    });
  }
}

// ─── skill provider ──────────────────────────────────────────────────────────

class ClaudeCompatSkillProvider {
  constructor(ctx, control, config) {
    this.ctx = ctx;
    this.name = 'claude-compat';
    this.config = config;
    this.skillRank = config.skillRank ?? 50;
    this.source = config.skillSource ?? 'project-claude';
    this.userSkillRank = config.userSkillRank ?? 700;
    this.userSkillSource = config.userSkillSource ?? 'user-claude';
    this.userClaudeDir = resolveUserClaudeDir(config.userClaudeDir);
    control.signal.addEventListener('abort', () => {}, { once: true });
  }

  async list(options) {
    const cwd = options?.cwd;
    const candidates = [];
    // Project .claude needs a cwd to locate the project root; user ~/.claude
    // is cwd-independent (mirrors DSH's own user-dsh/user-agents roots, which
    // are scanned unconditionally).
    if (cwd !== undefined && cwd !== null) {
      const projectRoot = await findProjectRoot(cwd, this.config.projectRootMarkers);
      if (projectRoot !== undefined) {
        await this.addRootCandidates(candidates, join(projectRoot, '.claude'), this.source, this.skillRank);
      }
    }
    await this.addRootCandidates(candidates, this.userClaudeDir, this.userSkillSource, this.userSkillRank);
    return candidates;
  }

  async addRootCandidates(candidates, claudeDir, source, rank) {
    const provider = this.name;
    const tasks = [discoverSkills(join(claudeDir, 'skills'), provider, source, rank)];
    for (const [dir, fn] of [
      ['commands', discoverCommands],
      ['agents', discoverAgents],
    ]) {
      if (dir === 'agents' && this.config.enableAgents === false) continue;
      tasks.push(fn(join(claudeDir, dir), provider, source, rank));
    }
    const batches = await Promise.all(tasks);
    for (const batch of batches) candidates.push(...batch);
  }

  async get(candidate) {
    const locator = candidate.locator;
    const raw = await readTextSafe(locator.path);
    if (raw === undefined) return undefined;
    const parsed = parseFrontmatter(raw);
    let content;
    if (candidate.agentTools !== undefined) {
      // Agent-backed candidate: lead the body with the delegation instruction.
      content = renderAgentContent(candidate, (parsed?.body ?? raw).trim());
    } else {
      content = parsed === undefined ? raw.trim() : parsed.body.trim();
    }
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

// ─── discovery: <root>/.claude/skills (recursive, ≤3 levels) ─────────────────

async function discoverSkills(rootDir, providerName, source, rank) {
  const { readdir } = await import('node:fs/promises');
  const out = [];
  if (!(await pathExistsSafe(rootDir))) return out;
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

// ─── discovery: <root>/.claude/commands (flat) ───────────────────────────────

async function discoverCommands(rootDir, providerName, source, rank) {
  const { readdir } = await import('node:fs/promises');
  const out = [];
  if (!(await pathExistsSafe(rootDir))) return out;
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
  const parts = [];
  const seen = new Set();
  const pushRoot = (rootDir, cap) => {
    let remaining = cap;
    const files = listMdFilesSync(rootDir);
    for (const f of files) {
      const basename = f.split('/').pop();
      if (seen.has(basename)) continue; // higher-priority root already included
      let raw;
      try { raw = readFileSync(f, 'utf8'); } catch { continue; }
      const chunk = `## ${basename}\n\n${raw.trim()}\n`;
      if (chunk.length > remaining) break;
      remaining -= chunk.length;
      seen.add(basename);
      parts.push(chunk);
    }
  };
  // Project .claude/rules first: wins same-name collisions against ~/.claude.
  const projectRoot = findProjectRootSync(cwd, config.projectRootMarkers);
  if (projectRoot !== undefined) {
    pushRoot(join(projectRoot, '.claude', 'rules'), maxBytes);
  }
  pushRoot(join(resolveUserClaudeDir(config.userClaudeDir), 'rules'), config.userRulesMaxBytes ?? maxBytes);
  if (parts.length === 0) return '';
  // Exact envelope Claude Code uses in prependUserContext (api.ts):
  // user-role <system-reminder> with "# claudeMd" framing.
  return `<system-reminder>
As you answer the user's questions, you can use the following context:
# claudeMd
${parts.join('\n')}
      </system-reminder>`;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function pathExistsSafe(path) {
  try { await stat(path); return true; } catch { return false; }
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