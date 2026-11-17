import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildInventory, writeCompatState, readCompatState, toggleInventoryItem,
  trashInventoryItem, restoreInventoryItem, listTrashedItems } from '../src/inventory.js';
import { discoverPluginContent } from '../src/plugins.js';
import { createCompatibilityService } from '../src/compat-service.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dcc-host-inventory-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, value) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
  };
  put('.dsh/marker', '');
  const user = join(root, 'user');
  const plugin = join(user, 'plugins/cache/demo');
  put('user/plugins/installed_plugins.json', { plugins: { 'demo@m': [{ scope: 'user', installPath: plugin, version: '1' }] } });
  put('user/plugins/cache/demo/.claude-plugin/plugin.json', { name: 'demo', mcpServers: {
    shared: { command: 'node' }, helperPlugin: { type: 'http', url: 'https://example.invalid', headersHelper: 'exit 1' },
  } });
  put('user/plugins/cache/demo/hooks/hooks.json', { hooks: { PreToolUse: [], PostToolUse: [] } });
  put('user/plugins/cache/demo/rules/r.md', '# rule');
  const skill = '---\nname: same\ndescription: fixture\n---\nbody';
  put('user/plugins/cache/demo/skills/same/SKILL.md', skill);
  put('.claude/skills/same/SKILL.md', skill);
  put('user/skills/same/SKILL.md', skill);
  const config = { projectRootMarkers: ['.dsh'], userClaudeDir: user, pluginsRoot: join(user, 'plugins'), enablePluginMcp: true };
  const args = { cwd: root, config, managedDir: join(root, 'managed') };
  return { root, put, config, args };
}

test('inventory static MCP declarations never execute helpers or claim mounting', async (t) => {
  const f = fixture(t);
  const marker = join(f.root, 'helper-ran');
  f.put('user/.claude.json', { mcpServers: { shared: { type: 'http', url: 'https://example.invalid', headersHelper: `touch '${marker}'; printf '{}'` } } });
  const inv = await buildInventory(f.args);
  assert.equal(existsSync(marker), false);
  const rows = inv.items.filter((i) => i.kind === 'mcp');
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map((i) => i.id)).size, 3);
  assert.equal(rows.filter((i) => i.pluginKey === 'demo@m').length, 2);
  assert.ok(rows.every((i) => i.declarationOnly && !i.description.includes('mounted') && !i.description.includes('is off')));
  assert.equal(rows.find((i) => i.source === 'mcp').mcpScope, 'user');
});

test('plugin counts equal drill rows and hook wrapper is not an event', async (t) => {
  const f = fixture(t);
  f.put('user/settings.json', { enabledPlugins: { 'demo@m': false } });
  const inv = await buildInventory(f.args);
  const plugin = inv.items.find((i) => i.kind === 'plugin');
  for (const [kind, count] of Object.entries(plugin.provides)) {
    assert.equal(count, inv.items.filter((i) => i.kind === kind && i.pluginKey === 'demo@m').length, kind);
  }
  assert.equal(plugin.provides.skill, 1);
  assert.equal(plugin.provides.hook, 2);
  assert.equal(plugin.provides.rule, 1);
  assert.deepEqual(plugin.hookEvents, ['PreToolUse', 'PostToolUse']);
  assert.equal(inv.items.find((i) => i.kind === 'skill' && i.pluginKey).disabledInClaude, true);
  assert.deepEqual(await discoverPluginContent(f.config.pluginsRoot, 'test', 'claude-plugin', 750, { userClaudeDir: f.config.userClaudeDir }), []);
});

test('disabled project winner yields to enabled user candidate and plugin disable propagates', async (t) => {
  const f = fixture(t);
  await writeCompatState(f.root, new Set(['project-claude:same#skill', 'plugin:demo@m']));
  const inv = await buildInventory(f.args);
  const user = inv.items.find((i) => i.kind === 'skill' && i.source === 'user-claude');
  assert.equal(user.overriddenBy, undefined);
  const pluginSkill = inv.items.find((i) => i.kind === 'skill' && i.pluginKey);
  assert.equal(pluginSkill.disabledInDsh, false);
  assert.equal(pluginSkill.disabledByPlugin, true);
  assert.equal(pluginSkill.toggleable, false);
  assert.equal(pluginSkill.overriddenBy, undefined);
  const project = inv.items.find((i) => i.kind === 'skill' && i.source === 'project-claude');
  assert.equal(project.overriddenBy, undefined, 'disabled items remain visible without enabling duplicate view');
});


test('concurrent toggles retain all updates across distinct item ids', async (t) => {
  const f = fixture(t);
  const ids = Array.from({ length: 12 }, (_, i) => `project-claude:item${i}#command`);
  for (let i = 0; i < 12; i++) f.put(`.claude/commands/item${i}.md`, '---\ndescription: fixture\n---\nbody');
  await Promise.all(ids.map((id) => toggleInventoryItem({ ...f.args, id, disabled: true })));
  assert.deepEqual([...readCompatState(f.root).disabled].sort(), ids.sort());
});

test('trash API refuses settings hooks, rules and plugin-owned candidates', async (t) => {
  const f = fixture(t);
  f.put('.claude/settings.json', { hooks: { PreToolUse: [] } });
  const inv = await buildInventory(f.args);
  const targets = inv.items.filter((i) => i.kind === 'hook' || i.kind === 'rule' || (i.kind === 'skill' && i.pluginKey));
  for (const item of targets) {
    await assert.rejects(trashInventoryItem({ ...f.args, id: item.id }), /Only project or user/);
    assert.ok(existsSync(item.path));
  }
});

test('unreadable trash manifest refuses mutation and preserves original file', async (t) => {
  const f = fixture(t);
  mkdirSync(join(f.root, '.dsh/trash/manifest.json'), { recursive: true });
  const id = 'project-claude:same#skill';
  await assert.rejects(trashInventoryItem({ ...f.args, id }));
  assert.ok(existsSync(join(f.root, '.claude/skills/same/SKILL.md')));
  assert.equal(readCompatState(f.root).disabled.has(id), false);
  assert.throws(() => listTrashedItems(f.args));
});

test('restore refuses replacement files and retains recoverable trash', async (t) => {
  const f = fixture(t);
  const id = 'project-claude:same#skill';
  await trashInventoryItem({ ...f.args, id });
  f.put('.claude/skills/same/SKILL.md', 'replacement');
  await assert.rejects(restoreInventoryItem({ ...f.args, id }), /already exists/);
  assert.equal(readFileSync(join(f.root, '.claude/skills/same/SKILL.md'), 'utf8'), 'replacement');
  assert.equal(listTrashedItems(f.args).items.length, 1);
});

test('restore state-write failure rolls file and manifest back to trash', async (t) => {
  const f = fixture(t);
  const id = 'project-claude:same#skill';
  await trashInventoryItem({ ...f.args, id });
  const statePath = join(f.root, '.dsh/claude-compat-state.json');
  assert.ok(statePath.startsWith(f.root + '/'));
  rmSync(statePath);
  mkdirSync(statePath);
  await assert.rejects(restoreInventoryItem({ ...f.args, id }));
  assert.equal(existsSync(join(f.root, '.claude/skills/same/SKILL.md')), false);
  assert.equal(listTrashedItems(f.args).items.length, 1);
});


test('concurrent trash preserves distinct same-basename files and all manifest rows', async (t) => {
  const f = fixture(t);
  const ids = ['project-claude:same#skill', 'user-claude:same#skill'];
  await Promise.all(ids.map((id) => trashInventoryItem({ ...f.args, id })));
  assert.equal(listTrashedItems(f.args).items.length, 2);
  assert.equal(readCompatState(f.root).disabled.size, 2);
  await Promise.all(ids.map((id) => restoreInventoryItem({ ...f.args, id })));
  assert.equal(listTrashedItems(f.args).items.length, 0);
  assert.equal(readCompatState(f.root).disabled.size, 0);
  assert.ok(existsSync(join(f.root, '.claude/skills/same/SKILL.md')));
  assert.ok(existsSync(join(f.root, 'user/skills/same/SKILL.md')));
});


test('trash state-write failure restores original file and rolls manifest back', async (t) => {
  const f = fixture(t);
  mkdirSync(join(f.root, '.dsh/claude-compat-state.json'));
  const id = 'project-claude:same#skill';
  await assert.rejects(trashInventoryItem({ ...f.args, id }));
  assert.ok(existsSync(join(f.root, '.claude/skills/same/SKILL.md')));
  assert.equal(listTrashedItems(f.args).items.length, 0);
});

test('malformed trash manifests cannot be replaced by a later trash operation', async (t) => {
  const f = fixture(t);
  for (const raw of ['{broken', '{}', '[null]']) {
    f.put('.dsh/trash/manifest.json', raw);
    await assert.rejects(trashInventoryItem({ ...f.args, id: 'project-claude:same#skill' }));
    assert.equal(readFileSync(join(f.root, '.dsh/trash/manifest.json'), 'utf8'), raw);
    assert.ok(existsSync(join(f.root, '.claude/skills/same/SKILL.md')));
  }
});


test('inventory service returns lossless JSON for every kind and plugin MCP drill', async (t) => {
  const f = fixture(t);
  f.put('.claude/settings.json', { hooks: { PreToolUse: [] } });
  f.put('.claude/rules/project.md', '# project rule');
  f.put('.claude/commands/command.md', '---\ndescription: fixture\n---\nbody');
  f.put('.claude/agents/agent.md', '---\nname: agent\ndescription: fixture\n---\nbody');
  f.put('user/.claude.json', { mcpServers: { local: { command: 'node' } } });
  const service = createCompatibilityService({ get() {} }, f.config, () => {});
  t.after(() => service.dispose());
  for (const filter of [{ kind: 'mcp', plugin: 'demo@m' },
    ...['plugin', 'skill', 'command', 'agent', 'hook', 'rule', 'mcp'].map((kind) => ({ kind })), {}]) {
    const result = await service.execute({ action: 'inventory.list', cwd: f.root, limit: 100, ...filter });
    assert.equal(result.ok, true);
    assert.ok(result.items.length > 0, JSON.stringify(filter));
    assert.deepEqual(result, JSON.parse(JSON.stringify(result)), `lossless JSON: ${JSON.stringify(filter)}`);
  }
  const inventory = await buildInventory(f.args);
  assert.deepEqual(inventory, JSON.parse(JSON.stringify(inventory)));
  const plugin = inventory.items.find((item) => item.kind === 'plugin');
  assert.equal(Object.hasOwn(plugin.plugin, 'installedAt'), false);
  assert.equal(Object.hasOwn(plugin.plugin, 'lastUpdated'), false);

  // No project marker resolves to cwd by the existing root resolver contract.
  const cwd = join(f.root, 'markerless');
  mkdirSync(cwd);
  const markerless = createCompatibilityService({ get() {} },
    { ...f.config, projectRootMarkers: ['__missing_project_marker__'] }, () => {});
  t.after(() => markerless.dispose());
  const result = await markerless.execute({ action: 'inventory.list', cwd, limit: 100 });
  assert.equal(result.ok, true);
  assert.equal(result.projectRoot, cwd);
  assert.equal(result.statePath, join(cwd, '.dsh/claude-compat-state.json'));
  assert.deepEqual(result, JSON.parse(JSON.stringify(result)));
});
