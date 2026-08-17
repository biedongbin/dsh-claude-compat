// dsh-claude-compat: .claude/agents/*.md compatibility. DSH has no markdown
// subagent-definition format, so each agent file is surfaced as a DSH *skill*
// candidate: the frontmatter name (or filename stem) becomes the skill name
// (model- and user-invocable, so `/agent-name` works), the description doubles
// as whenToUse, and get() prefixes the body with an explicit subagent-delegation
// instruction. Project .claude/agents wins over ~/.claude/agents by name via
// the provider's rank (50 < 700) plus the shared dedupe flow.

import { join } from 'node:path';
import { isSkillName } from '@deepseek-ai/dsh-skill';
import {
  readTextSafe,
  stringField,
  parseFrontmatter,
  pathExists,
} from './lib.js';

const AGENT_HEADER = 'Agent delegation: use the subagent/background-agent capability with this persona and instructions.';

// Discover agent candidates from one agents dir (flat: *.md). Returns DSH skill
// candidates in the same shape as discoverSkills/discoverCommands so the
// registry's dedupe treats them uniformly.
export async function discoverAgents(rootDir, providerName, source, rank) {
  const out = [];
  if (!(await pathExists(rootDir))) return out;
  let entries;
  try {
    const { readdir } = await import('node:fs/promises');
    entries = await readdir(rootDir, { withFileTypes: true, encoding: 'utf8' });
  } catch { return out; }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const path = join(rootDir, entry.name);
    const raw = await readTextSafe(path);
    if (raw === undefined) continue;
    const parsed = parseFrontmatter(raw);
    const data = parsed?.data ?? {};
    const stem = entry.name.slice(0, -3);
    let name = stringField(data, 'name');
    if (name === undefined || !isSkillName(name)) name = stem;
    if (!isSkillName(name)) continue; // non-kebab names rejected by registry anyway
    const description = stringField(data, 'description')
      ?? firstLine(parsed?.body ?? raw, 100);
    const tools = stringField(data, 'tools');
    out.push({
      name,
      description,
      whenToUse: description,
      invocation: { modelInvocable: true, userInvocable: true },
      provider: providerName,
      source,
      rank,
      locator: { path, directory: rootDir },
      resourceBase: { kind: 'directory', path: rootDir },
      path,
      agentTools: tools,
    });
  }
  return out;
}

function firstLine(body, max) {
  if (typeof body !== 'string') return undefined;
  const line = body.split('\n').find((l) => l.trim() !== '') ?? '';
  const trimmed = line.trim();
  if (trimmed === '') return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

// Render the content the skill tool returns for an agent-backed candidate.
export function renderAgentContent(candidate, body) {
  const lines = [AGENT_HEADER];
  if (candidate.agentTools !== undefined) lines.push(`Tools: ${candidate.agentTools}`);
  lines.push('');
  lines.push(body);
  return lines.join('\n');
}