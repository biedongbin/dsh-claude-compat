// v0.5.0 focused self-check: plugin-marketplace support. Real-data based —
// hits the actual ~/.claude/plugins installs on this machine (omc etc.), plus
// synthetic fixtures for the manifest-less fallback, plugin MCP translation,
// and project-wins collision.

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { SkillRegistry } from '@deepseek-ai/dsh-skill';
import {
  readInstalledClaudePlugins,
  discoverPluginContent,
  translatePluginMcp,
} from '../src/plugins.js';
import { apply, Config } from '../src/index.js';

function makeSandbox(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

// ─── readInstalledClaudePlugins (real data) ──────────────────────────────────

test('readInstalledClaudePlugins: real ~/.claude/plugins registry', () => {
  const plugins = readInstalledClaudePlugins();
  assert.ok(plugins.length >= 2, `expected ≥2 plugins, got ${plugins.length}`);
  const omc = plugins.find((p) => p.name === 'oh-my-claudecode');
  assert.ok(omc, 'oh-my-claudecode present');
  assert.equal(omc.marketplace, 'omc');
  assert.equal(omc.version, '4.15.7');
  assert.equal(omc.installPath,
    join(homedir(), '.claude/plugins/cache/omc/oh-my-claudecode/4.15.7'));
  // every entry carries the 5 fields
  for (const p of plugins) {
    for (const k of ['key', 'name', 'marketplace', 'installPath', 'version']) {
      assert.equal(typeof p[k], 'string', `${p.key}.${k} is a string`);
    }
  }
  // malformed / missing → []
  assert.deepEqual(readInstalledClaudePlugins('/nonexistent-dcc-plugins'), []);
});

// ─── discoverPluginContent (real omc install) ────────────────────────────────

test('discoverPluginContent: real omc install yields skills/commands/agents', async () => {
  const skillsOnly = await discoverPluginContent(undefined, 'claude-compat', 'claude-plugin', 750);
  const withAgents = await discoverPluginContent(undefined, 'claude-compat', 'claude-plugin', 750, { enableAgents: true });

  const omcSkills = skillsOnly.filter((c) => c.path.includes('/omc/oh-my-claudecode/'));
  const skillNames = omcSkills.filter((c) => c.path.includes('/skills/'));
  const commandNames = omcSkills.filter((c) => c.path.includes('/commands/'));
  const agentNames = withAgents.filter((c) => c.path.includes('/agents/') && c.path.includes('/omc/oh-my-claudecode/'));

  assert.ok(skillNames.length >= 40, `expected ≥40 omc skills, got ${skillNames.length}`);
  assert.ok(commandNames.length >= 20, `expected ≥20 omc commands, got ${commandNames.length}`);
  assert.ok(agentNames.length >= 15, `expected ≥15 omc agents, got ${agentNames.length}`);

  // shape: kebab names, descriptions, rank/source propagated
  for (const c of omcSkills) {
    assert.match(c.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, `kebab name: ${c.name}`);
    assert.ok(typeof c.description === 'string' && c.description.length > 0, `description present: ${c.name}`);
    assert.equal(c.rank, 750);
    assert.equal(c.source, 'claude-plugin');
    assert.equal(c.provider, 'claude-compat');
  }
  // dedupe within plugin per kind: omc ships skills/ask AND commands/ask.md —
  // cross-kind same-name pairs are allowed (registry dedupe resolves, skill
  // wins); within one kind no duplicates.
  const omcAll = withAgents.filter((c) => c.path.includes('/omc/oh-my-claudecode/'));
  for (const kind of ['skills/', 'commands/', 'agents/']) {
    const names = omcAll.filter((c) => c.path.includes(`/${kind}`)).map((c) => c.name);
    assert.equal(new Set(names).size, names.length, `no duplicate names within omc ${kind}`);
  }
  // enableAgents default (undefined) also includes agents (only ===false disables)
  const defaultAgents = skillsOnly.filter((c) => c.path.includes('/agents/') && c.path.includes('/omc/'));
  assert.ok(defaultAgents.length >= 15, 'agents discovered when enableAgents omitted');
});

// ─── manifest-less fallback (synthetic fixture) ──────────────────────────────

function writeSkill(parentDir, name, description = `${name} skill`) {
  const dir = join(parentDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nbody of ${name}\n`);
}

test('discoverPluginContent: manifest-less plugin falls back to dir scan', async () => {
  const root = makeSandbox('dcc-plugins-');
  const installPath = join(root, 'cache', 'local', 'bare', '1.0.0');
  writeSkill(join(installPath, 'skills'), 'alpha');
  writeSkill(join(installPath, 'skills'), 'beta');
  mkdirSync(join(installPath, 'commands'), { recursive: true });
  writeFileSync(join(installPath, 'commands', 'gamma.md'), '---\ndescription: gamma cmd\n---\nrunnable\n');
  mkdirSync(join(root), { recursive: true });
  writeFileSync(join(root, 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: { 'bare@local': [{ scope: 'user', installPath, version: '1.0.0' }] },
  }));

  const candidates = await discoverPluginContent(root, 'claude-compat', 'claude-plugin', 750);
  const names = candidates.map((c) => c.name);
  assert.ok(names.includes('alpha'), 'alpha via fallback skills scan');
  assert.ok(names.includes('beta'), 'beta via fallback skills scan');
  assert.ok(names.includes('gamma'), 'gamma via fallback commands scan');
});

// ─── translatePluginMcp (synthetic fixture) ──────────────────────────────────

test('translatePluginMcp: manifest mcpServers path → server configs, ${CLAUDE_PLUGIN_ROOT} substituted', () => {
  const root = makeSandbox('dcc-pmcp-');
  writeFileSync(join(root, '.mcp.json'), JSON.stringify({
    mcpServers: { bridge: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/bridge/server.cjs'] } },
  }));
  const manifest = { name: 'fakeplug', version: '1.0.0', mcpServers: './.mcp.json' };
  const { servers, warns } = translatePluginMcp(manifest, root, { failOnStartupError: false });
  assert.equal(warns.length, 0);
  assert.equal(servers.length, 1);
  assert.equal(servers[0].transport, 'stdio');
  assert.equal(servers[0].command, 'node');
  assert.deepEqual(servers[0].args, [join(root, 'bridge/server.cjs')]);

  // no mcpServers / unreadable → empty
  assert.deepEqual(translatePluginMcp({ name: 'x' }, root), { servers: [], warns: [] });
  const missing = translatePluginMcp({ name: 'x', mcpServers: './nope.json' }, root);
  assert.equal(missing.servers.length, 0);
  assert.ok(missing.warns.length > 0);
});

// ─── collision: project skill wins over plugin skill via registry dedupe ────

test('plugins: project .claude skill (rank 50) wins same-name plugin skill (rank 750)', async () => {
  const project = makeSandbox('dcc-pcoll-project-');
  mkdirSync(join(project, '.git'));
  writeSkill(join(project, '.claude', 'skills'), 'alpha', 'project alpha');
  const userClaude = makeSandbox('dcc-pcoll-user-'); // empty user dir, no skills

  const pluginsRoot = makeSandbox('dcc-pcoll-plugins-');
  const installPath = join(pluginsRoot, 'cache', 'mk', 'plug', '1.0.0');
  writeSkill(join(installPath, 'skills'), 'alpha', 'plugin alpha');
  writeSkill(join(installPath, 'skills'), 'solo', 'plugin only');
  mkdirSync(pluginsRoot, { recursive: true });
  writeFileSync(join(pluginsRoot, 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: { 'plug@mk': [{ scope: 'user', installPath, version: '1.0.0' }] },
  }));

  const ctx = new Context();
  ctx.skills = new SkillRegistry(ctx);
  await ctx.plugin({ name: 'claude-compat', apply, Config }, {
    userClaudeDir: userClaude,
    projectRootMarkers: ['.git'],
    pluginsRoot,
    enablePlugins: true,
  });

  const skills = await ctx.skills.list({ cwd: project });
  const byName = new Map(skills.map((s) => [s.name, s]));
  assert.equal(byName.get('alpha').source, 'project-claude', 'project wins collision');
  assert.equal(byName.get('alpha').description, 'project alpha');
  assert.equal(byName.get('solo').source, 'claude-plugin', 'plugin-only skill still visible');
});
