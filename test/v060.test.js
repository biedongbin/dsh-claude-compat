// v0.6.0 tests: /plugin manager (pure functions + provider registration).
// CLI-dependent paths are exercised by test-evidence scripts, not here —
// the suite must stay hermetic (no claude binary, no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePluginList, listFromDisk, searchMarketplaces, runPluginCommand } from '../src/plugin-manager.js';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('parsePluginList: entry lines → structured plugins with enabled flag', () => {
  const out = [
    'Installed plugins:', '',
    '  ❯ omc@omc', '    Version: 4.15.7', '    Scope: user', '    Status: ✔ enabled', '',
    '  ❯ caveman@caveman', '    Version: 0d95', '    Scope: user', '    Status: ✘ disabled',
  ].join('\n');
  assert.deepEqual(parsePluginList(out), [
    { name: 'omc', marketplace: 'omc', version: '4.15.7', scope: 'user', enabled: true },
    { name: 'caveman', marketplace: 'caveman', version: '0d95', scope: 'user', enabled: false },
  ]);
  assert.deepEqual(parsePluginList('Installed plugins:'), []);
});

test('listFromDisk: installed_plugins.json + enabledPlugins mapping merge', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dpm-'));
  writeFileSync(join(dir, 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'a@official': [{ scope: 'user', version: '1.0.0' }],
      'b@official': [{ scope: 'user', version: '2.0.0' }],
    },
  }));
  const settings = join(dir, 'settings.json');
  writeFileSync(settings, JSON.stringify({ enabledPlugins: { 'b@official': false } }));
  const list = listFromDisk(dir, settings);
  // 'a' has no entry in enabledPlugins → default enabled; 'b' explicitly disabled.
  assert.equal(list.find((p) => p.name === 'a').enabled, true);
  assert.equal(list.find((p) => p.name === 'b').enabled, false);
});

test('searchMarketplaces: manifest scan matches name/description/tags', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsm-'));
  const mRoot = join(dir, 'marketplaces', 'official', '.claude-plugin');
  mkdirSync(mRoot, { recursive: true });
  writeFileSync(join(mRoot, 'marketplace.json'), JSON.stringify({
    plugins: [
      { name: 'github', description: 'GitHub integration', version: '1.0' },
      { name: 'other', description: 'unrelated', tags: ['git-hub-adjacent'] },
    ],
  }));
  const hits = searchMarketplaces('github', dir);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].installId, 'github@official');
  assert.deepEqual(searchMarketplaces('zzz-no-match', dir), []);
});

test('runPluginCommand: help with no args; dispatches via injected CLI dep', async () => {
  const help = await runPluginCommand('');
  assert.match(help, /# Claude Code Plugin Manager/);
  const helpExplicit = await runPluginCommand('help');
  assert.match(helpExplicit, /plugin install/);

  // Injected fake CLI: proves arg marshalling for every subcommand.
  const calls = [];
  const fake = async (args) => { calls.push(args.join(' ')); return { ok: true, stdout: 'stub' }; };
  await runPluginCommand('install foo@bar', { claude: fake });
  await runPluginCommand('uninstall foo', { claude: fake });
  await runPluginCommand('enable foo', { claude: fake });
  await runPluginCommand('disable foo', { claude: fake });
  await runPluginCommand('update foo', { claude: fake });
  await runPluginCommand('update', { claude: fake });
  await runPluginCommand('marketplace list', { claude: fake });
  await runPluginCommand('marketplace add owner/repo', { claude: fake });
  await runPluginCommand('marketplace remove official', { claude: fake });
  await runPluginCommand('marketplace update', { claude: fake });
  await runPluginCommand('foo@bar', { claude: fake }); // one-shot install syntax
  assert.deepEqual(calls, [
    'install foo@bar', 'uninstall foo', 'enable foo', 'disable foo',
    'update foo', 'update', 'marketplace list', 'marketplace add owner/repo',
    'marketplace remove official', 'marketplace update', 'install foo@bar',
  ]);
});

test('reload-cc-plugins/reload-skills: registered, get() triggers control.invalidate()', async () => {
  const { apply } = await import('../src/index.js');
  let provider; let invalidated = 0;
  apply({
    skills: { registerProvider: (f) => { provider = f({ signal: new AbortController().signal, invalidate: () => { invalidated += 1; } }); return () => {}; } },
    on: () => () => {},
  }, { enablePlugins: false });
  const list = await provider.list({ cwd: '/tmp' });
  const names = list.map((c) => c.name);
  assert.ok(names.includes('cc-plugin'));
  assert.ok(names.includes('reload-cc-plugins'));
  assert.ok(names.includes('reload-skills'));
  const before = invalidated;
  const def = await list.find((c) => c.name === 'reload-cc-plugins').get();
  assert.ok(def.body.includes('reloaded'));
  assert.ok(invalidated > before, 'get() must call control.invalidate()');
});
