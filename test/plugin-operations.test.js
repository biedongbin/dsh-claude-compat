import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { runPluginCommand, runPluginOperation } from '../src/plugin-manager.js';
import { discoverPluginContent, readInstalledClaudePlugins } from '../src/plugins.js';
import { pluginMcpServers } from '../src/index.js';
import { withEnv } from './env-helper.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dcc-operations-'));
  const userClaudeDir = join(root, 'claude config');
  const pluginsRoot = join(root, 'plugins');
  const cwd = join(root, 'project space');
  for (const path of [userClaudeDir, pluginsRoot, cwd]) mkdirSync(path, { recursive: true });
  t.after(() => {
    // Only remove this test's generated root, never a configuration directory.
    assert.equal(dirname(root), tmpdir());
    assert.ok(root.startsWith(join(tmpdir(), 'dcc-operations-')));
    rmSync(root, { recursive: true, force: true });
  });
  return { root, cwd, config: { userClaudeDir, pluginsRoot } };
}

function json(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

function installed(root, entries) {
  json(join(root, 'installed_plugins.json'), { version: 2, plugins: Object.fromEntries(
    Object.entries(entries).map(([key, installPath]) => [key, [{ scope: 'user', installPath, version: '1.0.0' }]]),
  ) });
}

function plugin(path, name) {
  json(join(path, '.claude-plugin', 'plugin.json'), { name, skills: './skills', mcpServers: { [name]: { command: name } } });
  const dir = join(path, 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} fixture\n---\nTest skill\n`);
}

function deferred() {
  let resolveDone;
  const promise = new Promise((done) => { resolveDone = done; });
  return { promise, resolve: resolveDone };
}

async function withFakeExecutable(f, source, operation) {
  const bin = join(f.root, 'bin');
  mkdirSync(bin);
  const executable = join(bin, 'claude');
  writeFileSync(executable, `#!${process.execPath}\n${source}\n`);
  chmodSync(executable, 0o755);
  const original = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${original ?? ''}`;
  try { return await operation(); }
  finally {
    if (original === undefined) delete process.env.PATH;
    else process.env.PATH = original;
  }
}

test('disabled user plugins contribute neither skills nor MCP, and list still exposes their status', async (t) => withEnv({}, async () => {
  const f = fixture(t);
  const active = join(f.root, 'active');
  const disabled = join(f.root, 'disabled');
  plugin(active, 'active');
  plugin(disabled, 'disabled');
  installed(f.config.pluginsRoot, { 'active@m': active, 'disabled@m': disabled });
  json(join(f.config.userClaudeDir, 'settings.json'), { enabledPlugins: { 'disabled@m': false } });
  assert.deepEqual(readInstalledClaudePlugins(f.config.pluginsRoot, f.config.userClaudeDir).map((p) => p.name), ['active']);
  const candidates = await discoverPluginContent(f.config.pluginsRoot, 'test', 'test', 750, { userClaudeDir: f.config.userClaudeDir });
  assert.deepEqual(candidates.map((p) => p.name), ['active']);
  const mcp = await pluginMcpServers(f.config, []);
  assert.deepEqual(mcp.names, ['active']);
  const list = await runPluginOperation({ action: 'list', cwd: f.cwd }, { config: f.config, claude: () => assert.fail('list must read JSON') });
  assert.equal(list.ok, true);
  assert.equal(list.items.find((p) => p.name === 'disabled').enabled, false);
}));

test('enablement uses explicit config directory before environment, is re-read, and handles invalid settings safely', async (t) => {
  const f = fixture(t);
  installed(f.config.pluginsRoot, { 'one@m': join(f.root, 'one') });
  const alternate = join(f.root, 'alternate');
  json(join(alternate, 'settings.json'), { enabledPlugins: { 'one@m': false } });
  await withEnv({ CLAUDE_CONFIG_DIR: alternate }, () => {
    assert.equal(readInstalledClaudePlugins(f.config.pluginsRoot, f.config.userClaudeDir).length, 1);
    json(join(f.config.userClaudeDir, 'settings.json'), { enabledPlugins: { 'one@m': false } });
    assert.equal(readInstalledClaudePlugins(f.config.pluginsRoot, f.config.userClaudeDir).length, 0);
    writeFileSync(join(f.config.userClaudeDir, 'settings.json'), '{ invalid');
    assert.deepEqual(readInstalledClaudePlugins(f.config.pluginsRoot, f.config.userClaudeDir), []);
  });
});

test('primary and seed precedence survives disabled entries; inline replacement cannot bypass a disabled install', async (t) => {
  const f = fixture(t);
  const seed = join(f.root, 'seed');
  const primaryPlugin = join(f.root, 'primary-plugin');
  const inline = join(f.root, 'inline');
  plugin(primaryPlugin, 'same');
  plugin(inline, 'same');
  installed(f.config.pluginsRoot, { 'same@m': primaryPlugin });
  installed(seed, { 'same@m': join(f.root, 'seed-copy'), 'seeded@m': join(f.root, 'seeded') });
  json(join(f.config.userClaudeDir, 'settings.json'), { enabledPlugins: { 'same@m': false, 'seeded@m': false } });
  await withEnv({ CLAUDE_CODE_PLUGIN_SEED_DIR: seed }, () => {
    assert.deepEqual(readInstalledClaudePlugins(f.config.pluginsRoot, f.config.userClaudeDir), []);
  });
  await withEnv({ CLAUDE_CODE_PLUGIN_SEED_DIR: seed, CLAUDE_CODE_PLUGIN_DIRS: inline }, () => {
    assert.deepEqual(readInstalledClaudePlugins(f.config.pluginsRoot, f.config.userClaudeDir), []);
    json(join(f.config.userClaudeDir, 'settings.json'), { enabledPlugins: { 'same@m': false, 'same@inline': true } });
    const selected = readInstalledClaudePlugins(f.config.pluginsRoot, f.config.userClaudeDir);
    assert.equal(selected.find((p) => p.name === 'same').installPath, inline);
    assert.equal(selected.filter((p) => p.name === 'same').length, 1);
  });
});

test('structured list and empty text wrapper use JSON without a CLI round trip', async (t) => withEnv({}, async () => {
  const f = fixture(t);
  installed(f.config.pluginsRoot, { 'alpha@market': join(f.root, 'alpha') });
  const deps = { config: f.config, cwd: f.cwd, claude: () => assert.fail('unexpected CLI') };
  const result = await runPluginOperation({ action: 'list', cwd: f.cwd }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.engine, 'disk');
  assert.equal(result.items[0].name, 'alpha');
  assert.match(await runPluginCommand('', deps), /alpha@market/);
  assert.match(await runPluginCommand('help', deps), /plugin install/);
}));

test('malformed registry returns an error instead of claiming no plugins', async (t) => withEnv({}, async () => {
  const f = fixture(t);
  writeFileSync(join(f.config.pluginsRoot, 'installed_plugins.json'), '{broken');
  const result = await runPluginOperation({ action: 'list', cwd: f.cwd }, { config: f.config });
  assert.equal(result.ok, false);
  assert.match(result.error, /JSON|property/i);
  assert.equal(result.items, undefined);
}));

test('search and marketplace list query their JSON catalogs', async (t) => withEnv({}, async () => {
  const f = fixture(t);
  json(join(f.config.pluginsRoot, 'marketplaces', 'official', '.claude-plugin', 'marketplace.json'), {
    plugins: [{ name: 'alpha', description: 'Source review', tags: ['quality'] }, { name: 'beta', description: 'Different' }],
  });
  json(join(f.config.pluginsRoot, 'known_marketplaces.json'), { official: { source: { source: 'github', repo: 'owner/repo' } } });
  const search = await runPluginOperation({ action: 'search', query: 'quality', cwd: f.cwd }, { config: f.config });
  assert.equal(search.ok, true);
  assert.deepEqual(search.items.map((p) => p.installId), ['alpha@official']);
  const all = await runPluginOperation({ action: 'search', query: '', cwd: f.cwd }, { config: f.config });
  assert.equal(all.ok, true);
  assert.deepEqual(all.items.map((p) => p.installId), ['alpha@official', 'beta@official']);
  const markets = await runPluginOperation({ action: 'marketplace-list', cwd: f.cwd }, { config: f.config });
  assert.equal(markets.ok, true);
  assert.deepEqual(markets.items.map((p) => p.name), ['official']);
}));

test('fake CLI receives exact arguments, session cwd, configured env and progress for every operation', async (t) => withEnv({}, async () => {
  const f = fixture(t);
  const calls = [];
  const progress = [];
  const deps = { config: { ...f.config, enablePluginMcp: true }, onProgress: (event) => progress.push(event),
    claude: async (args, timeout, context) => { calls.push({ args, timeout, context }); return { ok: true, stdout: 'completed' }; } };
  const requests = [
    ['install', 'alpha@m', ['install', 'alpha@m']], ['uninstall', 'alpha', ['uninstall', 'alpha']],
    ['enable', 'alpha', ['enable', 'alpha']], ['disable', 'alpha', ['disable', 'alpha']],
    ['update', 'alpha', ['update', 'alpha']], ['marketplace-list', undefined, ['marketplace', 'list']],
    ['marketplace-add', 'owner/repo', ['marketplace', 'add', 'owner/repo']],
    ['marketplace-remove', 'official', ['marketplace', 'remove', 'official']],
    ['marketplace-update', undefined, ['marketplace', 'update']],
  ];
  for (const [action, target, expected] of requests) {
    const result = await runPluginOperation({ action, ...(target ? { target } : {}), cwd: f.cwd }, deps);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.restartRequired, !action.startsWith('marketplace-'));
    const call = calls.at(-1);
    assert.deepEqual(call.args, action.startsWith('marketplace-') ? expected : [...expected, '--scope', 'user']);
    assert.equal(call.context.cwd, f.cwd);
    assert.equal(call.context.env.CLAUDE_CONFIG_DIR, f.config.userClaudeDir);
    assert.equal(call.context.env.CLAUDE_CODE_PLUGIN_CACHE_DIR, f.config.pluginsRoot);
  }
  assert.ok(progress.some((event) => event.phase === 'running'));
  assert.ok(progress.some((event) => event.phase === 'completed'));
}));

test('CLI authentication, network and executable failures never install from disk', async (t) => withEnv({}, async () => {
  const f = fixture(t);
  json(join(f.config.pluginsRoot, 'marketplaces', 'm', '.claude-plugin', 'marketplace.json'), { plugins: [{ name: 'alpha', source: '.', version: '1.0.0' }] });
  for (const error of ['Authentication failed', 'Network timeout', 'spawn claude ENOENT']) {
    const result = await runPluginOperation({ action: 'install', target: 'alpha@m', cwd: f.cwd }, {
      config: f.config, claude: async () => ({ ok: false, error }),
    });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes(error));
    assert.equal(existsSync(join(f.config.pluginsRoot, 'installed_plugins.json')), false);
    assert.equal(existsSync(join(f.config.userClaudeDir, 'settings.json')), false);
  }
}));

test('invalid parameters never reach the CLI', async (t) => withEnv({}, async () => {
  const f = fixture(t);
  const cases = [null, [], {}, { action: 'unknown' }, { action: 'install' }, { action: 'enable', target: '--all' },
    { action: 'install', target: '../escape' }, { action: 'install', target: 'a@m --flag' },
    { action: 'marketplace-add', target: '-option' }, { action: 'marketplace-remove', target: '../outside' },
    { action: 'list', scope: 'project' }, { action: 'list', cwd: 'relative' }, { action: 'search', query: 5 },
    { action: 'enable', target: 'alpha\ncommand' }, { action: 'list', target: 'alpha' },
    { action: 'list', query: 'unexpected' }, { action: 'list', extra: true }, { action: 'update' }];
  for (const request of cases) {
    const result = await runPluginOperation(request, { config: f.config, claude: () => assert.fail('invalid CLI call') });
    assert.equal(result.ok, false, JSON.stringify(request));
    assert.ok(result.error);
  }
}));

test('mutations sharing settings or cache are serialized, and queued abort cannot unlock a running operation', async (t) => withEnv({}, async () => {
  const f = fixture(t);
  const started = deferred();
  const finish = deferred();
  const calls = [];
  const fake = async (args) => {
    calls.push(args[1]);
    if (args[1] === 'first') { started.resolve(); await finish.promise; }
    return { ok: true };
  };
  const first = runPluginOperation({ action: 'enable', target: 'first', cwd: f.cwd }, { config: f.config, claude: fake });
  await started.promise;
  const controller = new AbortController();
  const second = runPluginOperation({ action: 'enable', target: 'second', cwd: f.cwd }, { config: f.config, claude: fake, signal: controller.signal });
  controller.abort();
  assert.equal((await second).ok, false);
  const third = runPluginOperation({ action: 'enable', target: 'third', cwd: f.cwd }, { config: f.config, claude: fake });
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(calls, ['first']);
  finish.resolve();
  assert.equal((await first).ok, true);
  assert.equal((await third).ok, true);
  assert.deepEqual(calls, ['first', 'third']);
}));

test('shared settings serialize operations even when caches differ', async (t) => withEnv({}, async () => {
  const f = fixture(t);
  const started = deferred();
  const finish = deferred();
  const calls = [];
  const fake = async (args) => {
    calls.push(args[1]);
    if (args[1] === 'first') { started.resolve(); await finish.promise; }
    return { ok: true };
  };
  const first = runPluginOperation({ action: 'disable', target: 'first', cwd: f.cwd }, { config: f.config, claude: fake });
  await started.promise;
  const second = runPluginOperation({ action: 'disable', target: 'second', cwd: f.cwd }, { config: { ...f.config, pluginsRoot: join(f.root, 'other-cache') }, claude: fake });
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(calls, ['first']);
  finish.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['first', 'second']);
}));

test('real spawn adapter uses cwd/config env and can be aborted without leaving the CLI alive', async (t) => withEnv({}, async () => {
  const f = fixture(t);
  const controller = new AbortController();
  let pid;
  let context;
  await withFakeExecutable(f, `
process.stdout.write(JSON.stringify({ pid: process.pid, cwd: process.cwd(), config: process.env.CLAUDE_CONFIG_DIR, cache: process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR, args: process.argv.slice(2) }) + '\\n');
setInterval(() => {}, 1000);
`, async () => {
    const result = await runPluginOperation({ action: 'enable', target: 'alpha', cwd: f.cwd }, {
      config: f.config, signal: controller.signal, onProgress: (event) => {
        if (event.phase === 'output' && event.stream === 'stdout') {
          context = JSON.parse(event.text.trim());
          pid = context.pid;
          controller.abort();
        }
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /cancel/i);
  });
  assert.equal(context.cwd, realpathSync(f.cwd));
  assert.equal(context.config, f.config.userClaudeDir);
  assert.equal(context.cache, f.config.pluginsRoot);
  assert.deepEqual(context.args, ['plugin', 'enable', 'alpha', '--scope', 'user']);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}));

test('an already cancelled operation never invokes its CLI adapter', async (t) => withEnv({}, async () => {
  const f = fixture(t);
  const controller = new AbortController();
  controller.abort();
  const result = await runPluginOperation({ action: 'install', target: 'alpha@m', cwd: f.cwd }, {
    config: f.config, signal: controller.signal, claude: () => assert.fail('aborted CLI call'),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /cancel/i);
}));

test('a missing executable fails explicitly and releases the configuration lock', async (t) => withEnv({}, async () => {
  const f = fixture(t);
  const original = process.env.PATH;
  process.env.PATH = '';
  try {
    const missing = await runPluginOperation({ action: 'enable', target: 'alpha', cwd: f.cwd }, { config: f.config });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /ENOENT.*disk mutation fallback/s);
  } finally {
    if (original === undefined) delete process.env.PATH;
    else process.env.PATH = original;
  }
  const after = await runPluginOperation({ action: 'enable', target: 'alpha', cwd: f.cwd }, {
    config: f.config, claude: async () => ({ ok: true }),
  });
  assert.equal(after.ok, true);
}));

test('management list reports malformed records and seed registries rather than an empty inventory', async (t) => {
  const f = fixture(t);
  json(join(f.config.pluginsRoot, 'installed_plugins.json'), { plugins: { 'broken@m': [{ scope: 'user', version: '1' }] } });
  await withEnv({}, async () => {
    const result = await runPluginOperation({ action: 'list', cwd: f.cwd }, { config: f.config });
    assert.equal(result.ok, false);
    assert.match(result.error, /installPath/);
  });
  installed(f.config.pluginsRoot, {});
  const seed = join(f.root, 'seed');
  mkdirSync(seed);
  writeFileSync(join(seed, 'installed_plugins.json'), '{invalid');
  await withEnv({ CLAUDE_CODE_PLUGIN_SEED_DIR: seed }, async () => {
    const result = await runPluginOperation({ action: 'list', cwd: f.cwd }, { config: f.config });
    assert.equal(result.ok, false);
    assert.equal(result.items, undefined);
  });
});

test('list capabilities distinguish primary installations from read-only seed and inline content', async (t) => {
  const f = fixture(t);
  installed(f.config.pluginsRoot, { 'primary@m': join(f.root, 'primary') });
  const seed = join(f.root, 'seed');
  installed(seed, { 'seed@m': join(f.root, 'seed-plugin') });
  const inline = join(f.root, 'inline');
  plugin(inline, 'inline');
  await withEnv({ CLAUDE_CODE_PLUGIN_SEED_DIR: seed, CLAUDE_CODE_PLUGIN_DIRS: inline }, async () => {
    const result = await runPluginOperation({ action: 'list', cwd: f.cwd }, { config: f.config });
    assert.equal(result.ok, true, result.error);
    const bySource = Object.fromEntries(result.items.map((item) => [item.sourceKind, item]));
    assert.equal(bySource.primary.operationTarget, 'primary@m');
    assert.equal(bySource.primary.capabilities.uninstall, true);
    for (const source of ['seed', 'inline']) {
      assert.equal(bySource[source].operationTarget, null);
      assert.equal(bySource[source].capabilities.uninstall, false);
      const operation = await runPluginOperation({ action: 'disable', target: bySource[source].key, cwd: f.cwd }, {
        config: f.config, claude: () => assert.fail('read-only source must not be sent to CLI'),
      });
      assert.equal(operation.ok, false);
      assert.match(operation.error, /read-only/);
    }
  });
});

test('symlink aliases share locks even when their cache directories have not been created', { skip: process.platform === 'win32' }, async (t) => withEnv({}, async () => {
  const f = fixture(t);
  const alias = join(f.root, 'alias');
  symlinkSync(f.config.userClaudeDir, alias);
  const started = deferred();
  const finish = deferred();
  const calls = [];
  const fake = async (args) => {
    calls.push(args[1]);
    if (args[1] === 'first') { started.resolve(); await finish.promise; }
    return { ok: true };
  };
  const config = { userClaudeDir: f.config.userClaudeDir, pluginsRoot: join(f.config.userClaudeDir, 'future-cache') };
  const first = runPluginOperation({ action: 'enable', target: 'first', cwd: f.cwd }, { config, claude: fake });
  await started.promise;
  const second = runPluginOperation({ action: 'enable', target: 'second', cwd: f.cwd }, {
    config: { userClaudeDir: alias, pluginsRoot: join(alias, 'future-cache') }, claude: fake,
  });
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(calls, ['first']);
  finish.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['first', 'second']);
}));

test('cancelling a CLI also terminates its helper process group', { skip: process.platform === 'win32' }, async (t) => withEnv({}, async () => {
  const f = fixture(t);
  const controller = new AbortController();
  let helperPid;
  await withFakeExecutable(f, `
const { spawn } = require('node:child_process');
const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
process.stdout.write(String(helper.pid) + '\\n');
setInterval(() => {}, 1000);
`, async () => {
    const result = await runPluginOperation({ action: 'enable', target: 'alpha', cwd: f.cwd }, {
      config: f.config, signal: controller.signal, onProgress: (event) => {
        if (event.phase === 'output' && event.stream === 'stdout') {
          helperPid = Number(event.text.trim());
          controller.abort();
        }
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /cancel/i);
  });
  // A killed orphan can briefly remain visible until the OS reaps it.
  let alive = true;
  for (let attempt = 0; attempt < 50 && alive; attempt += 1) {
    try { process.kill(helperPid, 0); }
    catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
    if (alive) await new Promise((done) => setTimeout(done, 10));
  }
  assert.equal(alive, false, 'CLI helper must exit before another configuration operation begins');
}));

test('Windows taskkill failure terminates the parent and quarantines configuration writes', { timeout: 3000 }, async (t) => withEnv({}, async () => {
  const f = fixture(t);
  const originalSpawn = childProcess.spawn;
  const originalExecFile = childProcess.execFile;
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  let taskkillCalls = 0;
  let parentKills = 0;
  const child = Object.assign(new EventEmitter(), {
    pid: 1234567, stdout: new PassThrough(), stderr: new PassThrough(),
    kill() { parentKills += 1; queueMicrotask(() => this.emit('close', null)); return true; },
  });
  const controller = new AbortController();
  try {
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    childProcess.spawn = () => child;
    childProcess.execFile = (command, args, options, callback) => {
      assert.equal(command, 'taskkill');
      taskkillCalls += 1;
      callback(Object.assign(new Error('spawn taskkill ENOENT'), { code: 'ENOENT' }));
      return new EventEmitter();
    };
    syncBuiltinESMExports();
    const result = await runPluginOperation({ action: 'enable', target: 'alpha', cwd: f.cwd }, {
      config: f.config, signal: controller.signal,
      onProgress: (event) => { if (event.phase === 'running') controller.abort(); },
    });
    assert.equal(result.ok, false);
    assert.equal(result.unknown, true);
    assert.match(result.error, /process-tree status is unknown/);
    assert.equal(taskkillCalls, 1);
    assert.equal(parentKills, 1);
    const retry = await runPluginOperation({ action: 'disable', target: 'alpha', cwd: f.cwd }, {
      config: f.config, claude: () => assert.fail('quarantined writes must not start a CLI'),
    });
    assert.equal(retry.ok, false);
    assert.equal(retry.unknown, true);
    assert.match(retry.error, /restart DSH/);
    const read = await runPluginOperation({ action: 'list', cwd: f.cwd }, { config: f.config });
    assert.equal(read.ok, true);
  } finally {
    childProcess.spawn = originalSpawn;
    childProcess.execFile = originalExecFile;
    Object.defineProperty(process, 'platform', platform);
    syncBuiltinESMExports();
  }
}));

test('unknown human CLI output remains text and never falsely reports an empty list', async (t) => withEnv({}, async () => {
  const f = fixture(t);
  const result = await runPluginOperation({ action: 'marketplace-list', cwd: f.cwd }, {
    config: f.config, claude: async () => ({ ok: true, stdout: 'Unrecognized future listing format' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.items, undefined);
  assert.equal(result.text, 'Unrecognized future listing format');
}));
