import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildInventory,
  compatStatePath,
  filterCandidatesByState,
  readCompatState,
  toggleInventoryItem,
  writeCompatState,
  trashInventoryItem,
  restoreInventoryItem,
  listTrashedItems,
} from '../src/inventory.js';

function fixtureProject() {
  const root = mkdtempSync(join(tmpdir(), 'dcc-inv-'));
  const claude = join(root, '.claude');
  mkdirSync(join(claude, 'skills', 'alpha-skill'), { recursive: true });
  writeFileSync(join(claude, 'skills', 'alpha-skill', 'SKILL.md'),
    '---\nname: alpha-skill\ndescription: project alpha\n---\nbody\n');
  mkdirSync(join(claude, 'commands'), { recursive: true });
  writeFileSync(join(claude, 'commands', 'deploy.md'), '---\ndescription: deploys\n---\nbody\n');
  mkdirSync(join(claude, 'rules'), { recursive: true });
  writeFileSync(join(claude, 'rules', 'policy.md'), '# policy\n');
  mkdirSync(join(root, '.dsh'), { recursive: true });
  return root;
}

function config(root) {
  // A user dir with nothing in it keeps user-scope lists empty and isolated.
  const user = mkdtempSync(join(tmpdir(), 'dcc-inv-user-'));
  return { projectRootMarkers: ['.dsh'], userClaudeDir: user, pluginsRoot: join(user, 'plugins') };
}

const CLEAN = [];

test('readCompatState: missing file means everything enabled', () => {
  const root = fixtureProject(); CLEAN.push(root);
  const state = readCompatState(root);
  assert.equal(state.disabled.size, 0);
});

test('writeCompatState + readCompatState roundtrip, atomic file shape', async () => {
  const root = fixtureProject(); CLEAN.push(root);
  await writeCompatState(root, new Set(['user-claude:x', 'plugin:y@m']));
  const raw = JSON.parse(readFileSync(compatStatePath(root), 'utf8'));
  assert.equal(raw.version, 1);
  assert.deepEqual(raw.disabled, { 'plugin:y@m': true, 'user-claude:x': true });
  assert.deepEqual([...readCompatState(root).disabled].sort(), ['plugin:y@m', 'user-claude:x']);
});

test('readCompatState: malformed file degrades to all-enabled', () => {
  const root = fixtureProject(); CLEAN.push(root);
  writeFileSync(compatStatePath(root), '{broken');
  assert.equal(readCompatState(root).disabled.size, 0);
});

test('buildInventory aggregates project skills, commands and rules with sources', async () => {
  const root = fixtureProject(); CLEAN.push(root);
  const inventory = await buildInventory({ cwd: root, config: config(root) });
  const skills = inventory.items.filter((i) => i.kind === 'skill');
  const commands = inventory.items.filter((i) => i.kind === 'command');
  const rules = inventory.items.filter((i) => i.kind === 'rule');
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, 'alpha-skill');
  assert.equal(skills[0].source, 'project-claude');
  assert.equal(skills[0].disabledInDsh, false);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].name, 'deploy');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].name, 'policy.md');
  assert.equal(rules[0].toggleable, false);
  assert.equal(inventory.counts.skill, 1);
  assert.equal(inventory.projectRoot, root);
});

test('same-name collision marks the loser overriddenBy and the winner stays clean', async () => {
  const root = fixtureProject(); CLEAN.push(root);
  const userDir = mkdtempSync(join(tmpdir(), 'dcc-inv-user-')); CLEAN.push(userDir);
  mkdirSync(join(userDir, 'skills', 'alpha-skill'), { recursive: true });
  writeFileSync(join(userDir, 'skills', 'alpha-skill', 'SKILL.md'),
    '---\nname: alpha-skill\ndescription: user alpha\n---\nbody\n');
  const cfg = { ...config(root), userClaudeDir: userDir, pluginsRoot: join(userDir, 'plugins') };
  const inventory = await buildInventory({ cwd: root, config: cfg });
  const pair = inventory.items.filter((i) => i.kind === 'skill');
  assert.equal(pair.length, 2);
  const winner = pair.find((i) => i.source === 'project-claude');
  const loser = pair.find((i) => i.source === 'user-claude');
  assert.equal(winner.overriddenBy, undefined);
  assert.equal(loser.overriddenBy, 'project-claude:alpha-skill#skill');
});

test('toggleInventoryItem persists, validates ids, and flips the flag', async () => {
  const root = fixtureProject(); CLEAN.push(root);
  const cfg = config(root);
  await assert.rejects(() => toggleInventoryItem({ cwd: root, config: cfg, id: 'nope:missing', disabled: true }),
    /Unknown inventory item/);
  await toggleInventoryItem({ cwd: root, config: cfg, id: 'project-claude:alpha-skill#skill', disabled: true });
  const after = await buildInventory({ cwd: root, config: cfg });
  const skill = after.items.find((i) => i.id === 'project-claude:alpha-skill#skill');
  assert.equal(skill.disabledInDsh, true);
  assert.equal(after.disabledCount, 1);
  await toggleInventoryItem({ cwd: root, config: cfg, id: 'project-claude:alpha-skill#skill', disabled: false });
  assert.equal(readCompatState(root).disabled.size, 0);
  // Display-only kinds refuse the toggle.
  const rule = (await buildInventory({ cwd: root, config: cfg })).items.find((i) => i.kind === 'rule');
  await assert.rejects(() => toggleInventoryItem({ cwd: root, config: cfg, id: rule.id, disabled: true }),
    /display-only/);
});

test('filterCandidatesByState drops the toggled candidate and manager skills survive', () => {
  const root = fixtureProject(); CLEAN.push(root);
  const candidates = [
    { name: 'alpha-skill', source: 'project-claude', path: join(root, '.claude/skills/alpha-skill/SKILL.md'), rank: 50 },
    { name: 'cc-plugin', source: 'claude-compat-manager', locator: { kind: 'inline' }, rank: 40 },
  ];
  const filteredOff = filterCandidatesByState(candidates, root, config(root));
  assert.equal(filteredOff.length, 2); // no state file → nothing filtered
  writeFileSync(compatStatePath(root), JSON.stringify({ version: 1, disabled: { 'project-claude:alpha-skill#skill': true } }));
  const filtered = filterCandidatesByState(candidates, root, config(root));
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].name, 'cc-plugin');
});

test('filterCandidatesByState without a cwd passes candidates through', () => {
  const candidates = [{ name: 'x', source: 'user-claude', path: '/tmp/x', rank: 700 }];
  assert.equal(filterCandidatesByState(candidates, undefined, config('/tmp')), candidates);
});

test('trash moves a file-backed item to .dsh/trash and disables it; restore undoes both', async () => {
  const root = fixtureProject(); CLEAN.push(root);
  const cfg = config(root);
  const id = 'project-claude:alpha-skill#skill';
  const before = (await buildInventory({ cwd: root, config: cfg })).items.find((i) => i.id === id);
  assert.ok(before, 'alpha-skill present before trash');
  await trashInventoryItem({ cwd: root, config: cfg, id });
  // The file is gone, so discovery no longer yields the item at all.
  const after = (await buildInventory({ cwd: root, config: cfg })).items.find((i) => i.id === id);
  assert.equal(after, undefined);
  assert.equal(existsSync(before.path), false);
  const trashed = listTrashedItems({ cwd: root, config: cfg });
  assert.equal(trashed.items.length, 1);
  assert.equal(trashed.items[0].id, id);
  // Double-trash refuses.
  await assert.rejects(() => trashInventoryItem({ cwd: root, config: cfg, id }), /already in the trash/);
  await restoreInventoryItem({ cwd: root, config: cfg, id });
  assert.equal(existsSync(before.path), true);
  assert.equal(readCompatState(root).disabled.size, 0);
  assert.equal(listTrashedItems({ cwd: root, config: cfg }).items.length, 0);
});

test('same-name items from different plugins get distinct ids', async () => {
  const root = fixtureProject(); CLEAN.push(root);
  const userDir = mkdtempSync(join(tmpdir(), 'dcc-inv-user-')); CLEAN.push(userDir);
  // Two installed plugins that both ship an `architect` agent.
  const pluginsRoot = join(userDir, 'plugins');
  const installed = { plugins: {} };
  for (const key of ['alpha@m1', 'beta@m2']) {
    const [name] = key.split('@');
    const dir = join(pluginsRoot, 'cache', name);
    mkdirSync(join(dir, 'agents'), { recursive: true });
    writeFileSync(join(dir, 'agents', 'architect.md'), '---\nname: architect\ndescription: from ' + name + '\n---\nbody\n');
    installed.plugins[key] = [{ scope: 'user', installPath: dir, version: '1.0.0' }];
  }
  writeFileSync(join(pluginsRoot, 'installed_plugins.json'), JSON.stringify(installed));
  const cfg = { projectRootMarkers: ['.dsh'], userClaudeDir: userDir, pluginsRoot };
  const inventory = await buildInventory({ cwd: root, config: cfg });
  const agents = inventory.items.filter((i) => i.name === 'architect' && i.kind === 'agent');
  assert.equal(agents.length, 2);
  assert.equal(new Set(agents.map((i) => i.id)).size, 2, 'ids must be distinct per plugin');
  for (const agent of agents) assert.match(agent.id, /^claude-plugin:(alpha@m1|beta@m2):architect#agent$/);
  // The loser names its owner and never points at itself.
  const loser = agents.find((i) => i.overriddenBy !== undefined);
  const winner = agents.find((i) => i.overriddenBy === undefined);
  assert.ok(loser && winner);
  assert.notEqual(loser.overriddenBy, loser.id);
  assert.equal(loser.overriddenBy, winner.id);
  assert.ok(loser.overriddenByName);
});

test('a same-plugin duplicate names the winning KIND, not just the plugin', async () => {
  const root = fixtureProject(); CLEAN.push(root);
  // omc-style plugin: ships `ask` as BOTH a skill and a command.
  const claude = join(root, '.claude');
  mkdirSync(join(claude, 'skills', 'ask'), { recursive: true });
  writeFileSync(join(claude, 'skills', 'ask', 'SKILL.md'), '---\nname: ask\ndescription: skill copy\n---\nbody\n');
  mkdirSync(join(claude, 'commands'), { recursive: true });
  writeFileSync(join(claude, 'commands', 'ask.md'), '---\ndescription: command copy\n---\nbody\n');
  const inventory = await buildInventory({ cwd: root, config: config(root) });
  const rows = inventory.items.filter((i) => i.name === 'ask' && i.kind !== 'plugin');
  assert.equal(rows.length, 2);
  const loser = rows.find((i) => i.overriddenBy !== undefined);
  const winner = rows.find((i) => i.overriddenBy === undefined);
  assert.ok(loser && winner);
  assert.equal(loser.kind, 'command');
  assert.equal(loser.overriddenByKind, 'skill', 'the difference is the kind, not the plugin');
  assert.equal(loser.overriddenBySamePlugin, true);
  assert.equal(loser.overriddenByPluginName === undefined || typeof loser.overriddenByName === 'string' || loser.overriddenByName === null, true);
  assert.ok(loser.overriddenByFile, 'the winning file is reported so the message can be concrete');
});

test('a plugin item reports what it provides, per kind', async () => {
  const root = fixtureProject(); CLEAN.push(root);
  const userDir = mkdtempSync(join(tmpdir(), 'dcc-inv-user-')); CLEAN.push(userDir);
  const pluginsRoot = join(userDir, 'plugins');
  const installPath = join(pluginsRoot, 'cache', 'demo');
  mkdirSync(join(installPath, 'skills', 'one'), { recursive: true });
  writeFileSync(join(installPath, 'skills', 'one', 'SKILL.md'), '---\nname: one\ndescription: s\n---\nb\n');
  mkdirSync(join(installPath, 'commands'), { recursive: true });
  writeFileSync(join(installPath, 'commands', 'go.md'), '---\ndescription: c\n---\nb\n');
  mkdirSync(join(installPath, 'agents'), { recursive: true });
  writeFileSync(join(installPath, 'agents', 'helper.md'), '---\nname: helper\ndescription: a\n---\nb\n');
  mkdirSync(join(installPath, 'rules'), { recursive: true });
  writeFileSync(join(installPath, 'rules', 'r.md'), '# r\n');
  mkdirSync(join(installPath, '.claude-plugin'), { recursive: true });
  // Real manifests declare their content dirs; discovery reads them from here.
  writeFileSync(join(installPath, '.claude-plugin', 'plugin.json'), JSON.stringify({
    name: 'demo', skills: './skills', commands: './commands', agents: './agents',
    mcpServers: { demo: { command: 'node' } },
  }));
  writeFileSync(join(pluginsRoot, 'installed_plugins.json'), JSON.stringify({ plugins: { 'demo@m': [{ scope: 'user', installPath, version: '1.0.0' }] } }));
  const cfg = { projectRootMarkers: ['.dsh'], userClaudeDir: userDir, pluginsRoot };
  const inventory = await buildInventory({ cwd: root, config: cfg });
  const plugin = inventory.items.find((i) => i.kind === 'plugin' && i.plugin?.key === 'demo@m');
  assert.ok(plugin, 'plugin row present');
  assert.deepEqual(plugin.provides.skill, 1);
  assert.deepEqual(plugin.provides.command, 1);
  assert.deepEqual(plugin.provides.agent, 1);
  assert.equal(plugin.provides.rule, 1, 'a rules/ dir is counted');
  assert.equal(plugin.provides.mcp, 1, 'manifest mcpServers are counted');
  assert.ok(plugin.providesTotal >= 4);
});

test('trash refuses plugins and unknown ids', async () => {
  const root = fixtureProject(); CLEAN.push(root);
  const cfg = config(root);
  await assert.rejects(() => trashInventoryItem({ cwd: root, config: cfg, id: 'nope:missing' }), /Unknown inventory item/);
  await assert.rejects(() => trashInventoryItem({ cwd: root, config: cfg, id: 'plugin:x@m' }), /plugins.uninstall/);
});

process.on('exit', () => { for (const dir of CLEAN) rmSync(dir, { recursive: true, force: true }); });
