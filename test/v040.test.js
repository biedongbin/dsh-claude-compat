// v0.4.0 focused self-check: MCP translation, hook matcher/decision mapping
// (all pure, no subprocess), and .claude/agents discovery + project-wins
// dedupe against the real SkillRegistry (like self-check.test.js).

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { SkillRegistry } from '@deepseek-ai/dsh-skill';
import { translateMcpServers } from '../src/mcp.js';
import { compileMatcher, mapPreHookOutput, mapPostHookOutput } from '../src/hooks.js';
import { discoverAgents, renderAgentContent } from '../src/agents.js';
import { apply, Config } from '../src/index.js';

function makeSandbox(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

// ─── mcp ─────────────────────────────────────────────────────────────────────

test('translateMcpServers: stdio + http + skip rules', () => {
  const { servers, warns } = translateMcpServers(JSON.stringify({
    mcpServers: {
      'my-tools': { command: 'npx', args: ['-y', 'server'], env: { FOO: '1' } },
      'remote-api': { url: 'https://example.com/mcp', headers: { Authorization: 'x' } },
      'http-typed': { type: 'http', url: 'https://example.com/sse' },
      'se-typed': { type: 'sse', url: 'https://example.com/sse' },
      broken: { command: 42 },
      noserver: {},
    },
  }), { failOnStartupError: true });

  const stdio = servers.find((s) => s.serverName === 'my-tools');
  assert.deepEqual(stdio, {
    serverName: 'my-tools',
    toolCallTimeoutMs: 60_000,
    failOnStartupError: true,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'server'],
    env: { FOO: '1' },
    cwd: '',
  });
  const http = servers.find((s) => s.serverName === 'remote-api');
  assert.equal(http.transport, 'streamable-http');
  assert.equal(http.url, 'https://example.com/mcp');
  assert.equal(servers.some((s) => s.serverName === 'my-tools'), true);
  assert.equal(servers.some((s) => s.serverName === 'broken'), false, 'non-string command skipped');
  assert.equal(servers.some((s) => s.serverName === 'noserver'), false);
  assert.ok(warns.some((w) => w.startsWith('broken')), 'skip reported for broken entry');
  assert.ok(warns.some((w) => w.startsWith('noserver')), 'skip reported for entryless');
});

test('translateMcpServers: invalid json / missing mcpServers / name sanitation', () => {
  const bad = translateMcpServers('not json');
  assert.deepEqual(bad.servers, []);
  assert.ok(bad.warns[0].startsWith('invalid-json'));

  const noServers = translateMcpServers('{"a":1}');
  assert.deepEqual(noServers.servers, []);

  const { servers } = translateMcpServers(JSON.stringify({
    mcpServers: { 'weird name!': { command: 'go' } },
  }));
  assert.equal(servers[0].serverName, 'weird_name_', 'name sanitized to serverName pattern');
  assert.ok(servers[0].serverName.length <= 32);
});

// ─── hook matcher ────────────────────────────────────────────────────────────

test('compileMatcher: exact, alternation, wildcard, malformed', () => {
  const bash = compileMatcher('Bash');
  assert.equal(bash('Bash'), true);
  assert.equal(bash('Bash|Edit'), false);

  const either = compileMatcher('Bash|Edit');
  assert.equal(either('Bash'), true);
  assert.equal(either('Edit'), true);
  assert.equal(either('Read'), false);

  const any = compileMatcher('.*');
  assert.equal(any('anything-at-all'), true);
  const star = compileMatcher('*');
  assert.equal(star('x'), true);

  const none = compileMatcher('[');
  assert.equal(none('x'), false, 'unparseable regex degrades to never-match');
  assert.equal(compileMatcher(undefined)('x'), false, 'non-string degrades to never-match');
});

// ─── hook decision mapping ───────────────────────────────────────────────────

test('mapPreHookOutput: exit 2 denies, hookSpecificOutput overrides, other codes allow with warn', () => {
  let warned = '';
  assert.deepEqual(mapPreHookOutput(0, 'ok'), { kind: 'allow' });
  assert.deepEqual(mapPreHookOutput(2, 'no you may not'),
    { kind: 'deny', reason: 'no you may not' });
  assert.deepEqual(mapPreHookOutput(2, ''),
    { kind: 'deny', reason: 'blocked by hook' });

  const denyJson = mapPreHookOutput(0, JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'denied via json' },
  }));
  assert.equal(denyJson.kind, 'deny');
  assert.equal(denyJson.reason, 'denied via json');

  const askJson = mapPreHookOutput(0, JSON.stringify({
    hookSpecificOutput: { permissionDecision: 'ask', permissionDecisionReason: 'ask me' },
  }));
  assert.equal(askJson.kind, 'ask');

  const other = mapPreHookOutput(3, 'boom', { warn: (m) => { warned = m; } });
  assert.equal(other.kind, 'allow');
  assert.match(warned, /code 3/);
});

test('mapPostHookOutput: exit 2 blocks with feedback, additionalContext becomes a user message, else accept', () => {
  let warned = '';
  const block = mapPostHookOutput(2, 'redo it');
  assert.equal(block.kind, 'block');
  assert.deepEqual(block.feedback, [{ type: 'text', text: 'redo it' }]);

  const withCtx = mapPostHookOutput(0, JSON.stringify({ additionalContext: 'remember this fact' }));
  assert.equal(withCtx.kind, 'accept');
  assert.equal(withCtx.additionalContexts.length, 1);
  assert.equal(withCtx.additionalContexts[0].source.kind, 'claude-compat');
  assert.equal(withCtx.additionalContexts[0].content[0].text, 'remember this fact');

  const plain = mapPostHookOutput(0, '');
  assert.deepEqual(plain, { kind: 'accept' });

  const nonJson = mapPostHookOutput(0, 'just some output');
  assert.deepEqual(nonJson, { kind: 'accept' });

  const other = mapPostHookOutput(7, 'x', { warn: (m) => { warned = m; } });
  assert.equal(other.kind, 'accept');
  assert.match(warned, /code 7/);
});

// ─── agents discovery + dedupe ───────────────────────────────────────────────

function writeAgent(dir, stem, { name, description, tools, model, body }) {
  const fm = [
    '---',
    ...(name !== undefined ? [`name: ${name}`] : []),
    ...(description !== undefined ? [`description: ${description}`] : []),
    ...(tools !== undefined ? [`tools: ${tools}`] : []),
    ...(model !== undefined ? [`model: ${model}`] : []),
    '---',
    '',
    body ?? 'agent instructions',
  ].join('\n');
  writeFileSync(join(dir, `${stem}.md`), fm);
}

test('discoverAgents: frontmatter name, description fallback, tools carried', async () => {
  const dir = makeSandbox('dcc-agents-');
  writeAgent(dir, 'research', { description: 'deep research agent', tools: 'Bash, Read, WebSearch', body: 'Be thorough.\n' });
  writeFileSync(join(dir, 'no-frontmatter.md'), 'just a body line for fallback\n');
  writeFileSync(join(dir, 'bad name!.md'), '---\ndescription: spaces\n---\nbody\n'); // non-kebab stem → skipped

  const candidates = await discoverAgents(dir, 'claude-compat', 'project-claude', 50);
  assert.equal(candidates.length, 2);
  const research = candidates.find((c) => c.name === 'research');
  assert.equal(research.description, 'deep research agent');
  assert.equal(research.whenToUse, 'deep research agent');
  assert.equal(research.agentTools, 'Bash, Read, WebSearch');
  assert.deepEqual(research.invocation, { modelInvocable: true, userInvocable: true });
  assert.equal(research.source, 'project-claude');
  assert.equal(research.rank, 50);
  assert.equal(research.resourceBase.path, dir);

  const fallback = candidates.find((c) => c.name === 'no-frontmatter');
  assert.equal(fallback.description, 'just a body line for fallback', 'first body line as fallback description');
  assert.equal(fallback.whenToUse, 'just a body line for fallback');

  // get() content: delegation header + tools line + verbatim body
  const rendered = renderAgentContent(research, 'Be thorough.');
  assert.match(rendered, /^Agent delegation: use the subagent\/background-agent capability/);
  assert.match(rendered, /Tools: Bash, Read, WebSearch/);
  assert.ok(rendered.endsWith('Be thorough.'));
});

test('agents: project .claude/agents wins ~/.claude/agents via registry dedupe', async () => {
  const project = makeSandbox('dcc-agents-project-');
  mkdirSync(join(project, '.git'));
  mkdirSync(join(project, '.claude', 'agents'), { recursive: true });
  writeAgent(join(project, '.claude', 'agents'), 'research', { description: 'project research' });

  const userClaude = makeSandbox('dcc-agents-user-');
  mkdirSync(join(userClaude, 'agents'), { recursive: true });
  writeAgent(join(userClaude, 'agents'), 'research', { description: 'user research' });
  writeAgent(join(userClaude, 'agents'), 'code-review', { description: 'user review' });

  const ctx = new Context();
  ctx.skills = new SkillRegistry(ctx);
  await ctx.plugin({ name: 'claude-compat', apply, Config }, {
    userClaudeDir: userClaude,
    projectRootMarkers: ['.git'],
  });

  const skills = await ctx.skills.list({ cwd: project });
  const byName = new Map(skills.map((s) => [s.name, s]));
  assert.equal(byName.get('research').source, 'project-claude', 'project agent wins same-name user agent');
  assert.equal(byName.get('research').description, 'project research');
  assert.equal(byName.get('code-review').source, 'user-claude', 'user-only agent still visible');
  assert.equal(byName.get('code-review').description, 'user review');
});