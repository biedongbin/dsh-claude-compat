import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createCompatibilityService } from '../src/compat-service.js';
import { withEnv } from './env-helper.js';

test('duplicate badge follows plugin, source and search while sidebar counts remain global', async (t) => withEnv({}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dcc-list-contract-'));
  t.after(async () => {
    assert.equal(dirname(root), tmpdir());
    assert.ok(root.startsWith(join(tmpdir(), 'dcc-list-contract-')));
    await rm(root, { recursive: true, force: true });
  });
  const userClaudeDir = join(root, 'user'), pluginsRoot = join(userClaudeDir, 'plugins');
  await mkdir(join(root, '.dsh'), { recursive: true });
  await mkdir(pluginsRoot, { recursive: true });
  const records = {};
  for (const name of ['one', 'two']) {
    const installPath = join(pluginsRoot, 'cache', name);
    await mkdir(join(installPath, 'skills', name), { recursive: true });
    await mkdir(join(installPath, 'commands'), { recursive: true });
    await mkdir(join(installPath, '.claude-plugin'), { recursive: true });
    await writeFile(join(installPath, '.claude-plugin', 'plugin.json'), JSON.stringify({ name }));
    await writeFile(join(installPath, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}\n---\nbody`);
    await writeFile(join(installPath, 'commands', `${name}.md`), `---\ndescription: ${name}\n---\nbody`);
    records[`${name}@test`] = [{ scope: 'user', version: '1', installPath }];
  }
  await writeFile(join(pluginsRoot, 'installed_plugins.json'), JSON.stringify({ plugins: records }));
  const service = createCompatibilityService({ get: () => undefined }, {
    userClaudeDir, pluginsRoot, projectRootMarkers: ['.dsh'], enableMcp: false,
  }, () => {});
  t.after(() => service.dispose());
  const list = (filters = {}) => service.execute({ action: 'inventory.list', cwd: root, kind: 'command', ...filters });
  const global = await list();
  assert.equal(global.shadowedCounts.command, 2);
  const drilled = await list({ plugin: 'one@test' });
  assert.equal(drilled.shadowedCounts.command, 1);
  assert.deepEqual(drilled.counts, global.counts);
  assert.equal((await list({ query: 'missing' })).shadowedCounts.command, 0);
  assert.equal((await list({ source: 'project-claude' })).shadowedCounts.command, 0);
  const expanded = await list({ plugin: 'one@test', duplicates: true });
  assert.equal(expanded.total, 1);
  assert.equal(expanded.items[0].name, 'one');
}));
