// Plugin MCP loading and the plugin manager's JSON reads: a file with the wrong shape is
// reported or skipped, and it never throws or stops the other plugins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pluginMcpServers } from '../src/index.js';
import { fallbackInstall, fallbackToggle, listFromDisk, searchMarketplaces } from '../src/plugin-manager.js';

function tempDir(prefix) {
  mkdirSync(join(process.cwd(), '.tmp'), { recursive: true });
  return mkdtempSync(join(process.cwd(), '.tmp', prefix));
}

function write(path, value) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
}

function pluginsRootWith(plugins) {
  const root = tempDir('dcc-pm-');
  const record = {};
  for (const [key, files] of Object.entries(plugins)) {
    const installPath = join(root, 'cache', key);
    mkdirSync(installPath, { recursive: true });
    for (const [name, value] of Object.entries(files)) write(join(installPath, name), value);
    record[key] = [{ scope: 'user', installPath, version: '1.0.0' }];
  }
  write(join(root, 'installed_plugins.json'), { version: 2, plugins: record });
  return root;
}

test('a plugin with no plugin.json still loads the .mcp.json at its root, and the others are not affected', async () => {
  const pluginsRoot = pluginsRootWith({
    'bare@m': { '.mcp.json': { mcpServers: { bare: { type: 'stdio', command: 'b' } } } },
    'full@m': {
      '.claude-plugin/plugin.json': { name: 'full', mcpServers: { full: { type: 'stdio', command: 'f' } } },
    },
    'broken@m': { '.claude-plugin/plugin.json': '{ nope' },
    'empty@m': {},
  });
  const warns = [];
  const { servers, names } = await pluginMcpServers({ pluginsRoot, userClaudeDir: tempDir('dcc-pm-user-') }, warns);
  assert.deepEqual(names.sort(), ['bare', 'full']);
  assert.equal(servers.length, 2);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /plugin broken@m: plugin\.json is not valid JSON \(.*\), its MCP servers are skipped/);
});

const BAD_ROOTS = ['null', '[]', '7', '"text"'];

test('the plugin manager treats a JSON file that is not an object as unreadable, and does not throw', async () => {
  for (const bad of BAD_ROOTS) {
    const dir = tempDir('dcc-pm-json-');
    write(join(dir, 'installed_plugins.json'), bad);
    write(join(dir, 'settings.json'), bad);
    assert.deepEqual(listFromDisk(dir, join(dir, 'settings.json')), [], bad);
    assert.deepEqual(fallbackToggle('x@m', true, dir, join(dir, 'settings.json')).ok, false, bad);
    const install = await fallbackInstall('x@m', dir, join(dir, 'settings.json'));
    assert.equal(install.ok, false, bad);
  }
});

test('a marketplace catalog with a wrong plugins value, or a non-object entry, gives no hit and does not throw', async () => {
  for (const plugins of [{}, 'x', null, [null, 5, { name: 'good', description: 'a good one' }]]) {
    const dir = tempDir('dcc-pm-market-');
    write(join(dir, 'marketplaces', 'm', '.claude-plugin', 'marketplace.json'), { plugins });
    const hits = searchMarketplaces('good', dir);
    assert.deepEqual(hits.map((hit) => hit.name), Array.isArray(plugins) ? ['good'] : []);
    const install = await fallbackInstall('good@m', dir, join(dir, 'settings.json'));
    assert.equal(install.ok === true || /not found|source/i.test(install.error ?? ''), true);
  }
});
