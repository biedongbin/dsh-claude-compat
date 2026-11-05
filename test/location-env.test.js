// Env-var redirection of Claude Code default locations (issue #1). Hermetic:
// every test clears and restores the location variables and uses temp dirs.
// Property tests use a seeded generator, so a failure reproduces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import {
  claudeProjectFolder,
  claudeProjectsDir,
  envPathList,
  envPluginDirs,
  resolveClaudePluginsRoot,
  resolveUserClaudeDir,
  validateClaudeLocationEnv,
} from '../src/lib.js';
import { readInstalledClaudePlugins } from '../src/plugins.js';
import { listClaudeSessions } from '../scripts/cc-resume.mjs';
import { runPluginCommand } from '../src/plugin-manager.js';
import { Config, apply } from '../src/index.js';
import { withEnv } from './env-helper.js';

const tmp = (prefix) => mkdtempSync(join(tmpdir(), prefix));

// mulberry32: small seeded generator, enough for property loops.
function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSegment(next) {
  const alphabet = 'abcXYZ019_-. ';
  const length = 1 + Math.floor(next() * 8);
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(next() * alphabet.length)];
  return out === '.' || out === '..' ? 'x' : out;
}

const randomAbsolute = (next) => `/${randomSegment(next)}/${randomSegment(next)}`;

// ─── CLAUDE_CONFIG_DIR ───────────────────────────────────────────────────────

test('CLAUDE_CONFIG_DIR replaces ~/.claude when no explicit dir is given', () => withEnv(
  { CLAUDE_CONFIG_DIR: '/cfg/dir' },
  () => {
    assert.equal(resolveUserClaudeDir(undefined), '/cfg/dir');
    assert.equal(resolveUserClaudeDir(''), '/cfg/dir');
  },
));

test('explicit userClaudeDir wins over CLAUDE_CONFIG_DIR', () => withEnv(
  { CLAUDE_CONFIG_DIR: '/cfg/dir' },
  () => assert.equal(resolveUserClaudeDir('/explicit/dir'), '/explicit/dir'),
));

test('default is ~/.claude when nothing is set, and an empty variable is ignored', async () => {
  await withEnv({}, () => assert.equal(resolveUserClaudeDir(), join(homedir(), '.claude')));
  await withEnv({ CLAUDE_CONFIG_DIR: '' }, () => {
    assert.equal(resolveUserClaudeDir(), join(homedir(), '.claude'));
  });
});

test('a relative path variable fails fast and names the variable', async () => {
  await withEnv({ CLAUDE_CONFIG_DIR: 'relative/dir' }, () => {
    assert.throws(() => resolveUserClaudeDir(), /CLAUDE_CONFIG_DIR.*absolute/);
  });
  await withEnv({ CLAUDE_CODE_PLUGIN_CACHE_DIR: '~/plugins' }, () => {
    assert.throws(() => resolveClaudePluginsRoot(), /CLAUDE_CODE_PLUGIN_CACHE_DIR.*absolute/);
  });
});

// ─── plugins root ────────────────────────────────────────────────────────────

test('plugins root: explicit > CLAUDE_CODE_PLUGIN_CACHE_DIR > <config>/plugins', async () => {
  await withEnv({ CLAUDE_CONFIG_DIR: '/cfg' }, () => {
    assert.equal(resolveClaudePluginsRoot(undefined), join('/cfg', 'plugins'));
  });
  await withEnv({ CLAUDE_CONFIG_DIR: '/cfg', CLAUDE_CODE_PLUGIN_CACHE_DIR: '/cache' }, () => {
    assert.equal(resolveClaudePluginsRoot(undefined), '/cache');
    assert.equal(resolveClaudePluginsRoot('/explicit'), '/explicit');
  });
});

test('a configured user dir moves the default plugins root with it', () => withEnv(
  { CLAUDE_CONFIG_DIR: '/cfg' },
  () => assert.equal(resolveClaudePluginsRoot(undefined, '/configured'), join('/configured', 'plugins')),
));

// ─── project folder name ─────────────────────────────────────────────────────

test('projects dir: derived from cwd, or the CLAUDE_CODE_PROJECT_DIR_NAME override', async () => {
  await withEnv({ CLAUDE_CONFIG_DIR: '/cfg' }, () => {
    assert.equal(claudeProjectsDir('/a/b'), join('/cfg', 'projects', '-a-b'));
  });
  await withEnv({ CLAUDE_CONFIG_DIR: '/cfg', CLAUDE_CODE_PROJECT_DIR_NAME: 'shared' }, () => {
    assert.equal(claudeProjectsDir('/a/b'), join('/cfg', 'projects', 'shared'));
  });
});

test('derived project folder: every non-alphanumeric character becomes a dash', () => {
  assert.equal(claudeProjectFolder('/a/b'), '-a-b');
  assert.equal(claudeProjectFolder('/Users/me/my.project'), '-Users-me-my-project');
  assert.equal(claudeProjectFolder('/tmp/my dir_x~y'), '-tmp-my-dir-x-y');
  assert.equal(claudeProjectFolder('/tmp/日本語'), '-tmp----');
});

test('derived project folder: a name over 200 characters is cut and gets a path hash', () => {
  const long = `/Users/me/${'a.b_c '.repeat(40)}`;
  const folder = claudeProjectFolder(long);
  assert.equal(folder.length, 207);
  assert.equal(folder.slice(0, 200), long.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 200));
  assert.equal(folder.slice(200), '-ni313b');
  const exact = `/${'x'.repeat(199)}`;
  assert.equal(claudeProjectFolder(exact), `-${'x'.repeat(199)}`);
  assert.notEqual(claudeProjectFolder(`${long}1`), claudeProjectFolder(`${long}2`));
});

test('project dir name is ignored without CLAUDE_CONFIG_DIR', () => withEnv(
  { CLAUDE_CODE_PROJECT_DIR_NAME: 'shared' },
  () => assert.equal(claudeProjectsDir('/a/b'), join(homedir(), '.claude', 'projects', '-a-b')),
));

test('project dir name: values Claude Code would ignore fall back to the derived name', async () => {
  const bad = ['..', '.', '../other', 'a/b', 'a b', 'x'.repeat(65), 'con', 'LPT1', 'nul'];
  for (const name of bad) {
    await withEnv({ CLAUDE_CONFIG_DIR: '/cfg', CLAUDE_CODE_PROJECT_DIR_NAME: name }, () => {
      assert.equal(claudeProjectsDir('/a/b'), join('/cfg', 'projects', '-a-b'), name);
    });
  }
  for (const name of ['w', 'work_1-b', 'x'.repeat(64)]) {
    await withEnv({ CLAUDE_CONFIG_DIR: '/cfg', CLAUDE_CODE_PROJECT_DIR_NAME: name }, () => {
      assert.equal(claudeProjectsDir('/a/b'), join('/cfg', 'projects', name), name);
    });
  }
});

test('cc-resume lists sessions from an explicit user dir, not only the env or default dir', async () => {
  const userDir = tmp('dcc-userdir-');
  const cwd = '/tmp/dcc.proj_x';
  const projDir = join(userDir, 'projects', claudeProjectFolder(cwd));
  mkdirSync(projDir, { recursive: true });
  const line = { type: 'user', message: { content: 'hello' }, timestamp: '2026-10-28T02:00:00.000Z', cwd };
  writeFileSync(join(projDir, 'aaaabbbb-1111.jsonl'), `${JSON.stringify(line)}\n`);
  await withEnv({}, () => {
    assert.equal(listClaudeSessions(cwd, 5, userDir).length, 1);
    assert.equal(listClaudeSessions(cwd, 5).length, 0);
  });
});

test('Config accepts an empty object: userClaudeDir and pluginsRoot stay unset', () => {
  const parsed = Config({});
  assert.equal(parsed.userClaudeDir, undefined);
  assert.equal(parsed.pluginsRoot, undefined);
});

// ─── path lists ──────────────────────────────────────────────────────────────

test('envPathList: unset and empty give an empty list; blanks are dropped', async () => {
  await withEnv({}, () => assert.deepEqual(envPathList('CLAUDE_CODE_PLUGIN_DIRS'), []));
  await withEnv({ CLAUDE_CODE_PLUGIN_DIRS: '' }, () => {
    assert.deepEqual(envPathList('CLAUDE_CODE_PLUGIN_DIRS'), []);
  });
  await withEnv({ CLAUDE_CODE_PLUGIN_DIRS: `/a${delimiter}${delimiter}/b` }, () => {
    assert.deepEqual(envPathList('CLAUDE_CODE_PLUGIN_DIRS'), ['/a', '/b']);
  });
});

test('envPathList: a relative entry fails fast and names the variable', async () => {
  for (const name of ['CLAUDE_CODE_PLUGIN_SEED_DIR', 'CLAUDE_CODE_PLUGIN_DIRS']) {
    await withEnv({ [name]: `/ok${delimiter}rel/dir` }, () => {
      assert.throws(() => envPathList(name), new RegExp(`${name}.*absolute`));
    });
  }
});

test('property: envPathList round-trips any list of absolute paths', async () => {
  const next = rng(100);
  for (let run = 0; run < 200; run += 1) {
    const list = Array.from({ length: Math.floor(next() * 5) }, () => randomAbsolute(next));
    const raw = list.flatMap((p) => (next() < 0.3 ? ['', p] : [p])).join(delimiter);
    await withEnv({ CLAUDE_CODE_PLUGIN_DIRS: raw }, () => {
      assert.deepEqual(envPathList('CLAUDE_CODE_PLUGIN_DIRS'), list, raw);
    });
  }
});

test('property: resolvers return the variable for any absolute value; explicit always wins', async () => {
  const next = rng(200);
  for (let run = 0; run < 200; run += 1) {
    const value = randomAbsolute(next);
    const explicit = randomAbsolute(next);
    await withEnv({ CLAUDE_CONFIG_DIR: value, CLAUDE_CODE_PLUGIN_CACHE_DIR: value }, () => {
      assert.equal(resolveUserClaudeDir(), value);
      assert.equal(resolveClaudePluginsRoot(), value);
      assert.equal(resolveUserClaudeDir(explicit), explicit);
      assert.equal(resolveClaudePluginsRoot(explicit, value), explicit);
      assert.equal(resolveUserClaudeDir(resolveUserClaudeDir(explicit)), explicit);
    });
  }
});

// ─── startup validation ──────────────────────────────────────────────────────

test('validateClaudeLocationEnv passes on a clean env and names the bad variable', async () => {
  await withEnv({}, () => validateClaudeLocationEnv());
  await withEnv({ CLAUDE_CODE_PLUGIN_SEED_DIR: 'rel' }, () => {
    assert.throws(() => validateClaudeLocationEnv(), /CLAUDE_CODE_PLUGIN_SEED_DIR/);
  });
});

test('validation checks the effective config: explicit values hide a bad variable', async () => {
  const env = { CLAUDE_CONFIG_DIR: 'relative', CLAUDE_CODE_PLUGIN_CACHE_DIR: 'relative' };
  await withEnv(env, () => {
    assert.throws(() => validateClaudeLocationEnv(), /CLAUDE_CONFIG_DIR/);
    validateClaudeLocationEnv({ userClaudeDir: '/u', pluginsRoot: '/p' });
    assert.throws(() => validateClaudeLocationEnv({ pluginsRoot: '/p' }), /CLAUDE_CONFIG_DIR/);
  });
  await withEnv({ CLAUDE_CODE_PLUGIN_CACHE_DIR: 'relative' }, () => {
    assert.throws(() => validateClaudeLocationEnv(), /CLAUDE_CODE_PLUGIN_CACHE_DIR/);
    validateClaudeLocationEnv({ pluginsRoot: '/p' });
  });
});

test('CLAUDE_CODE_PLUGIN_DIRS: absolute and ~ entries load, relative entries are skipped', async () => {
  const raw = ['/abs/one', '~/two', '~', 'relative/three', '', './four'].join(delimiter);
  await withEnv({ CLAUDE_CODE_PLUGIN_DIRS: raw }, () => {
    const { dirs, skipped } = envPluginDirs();
    assert.deepEqual(dirs, ['/abs/one', join(homedir(), 'two'), homedir()]);
    assert.deepEqual(skipped, ['relative/three', './four']);
    validateClaudeLocationEnv();
  });
});

test('apply() with a bad location variable logs one line and does not activate', async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    await withEnv({ CLAUDE_CONFIG_DIR: 'relative' }, () => apply({}, {}));
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not activated.*CLAUDE_CONFIG_DIR/);
});

// ─── installed plugins: primary, seed, inline ────────────────────────────────

function writeInstalled(root, entries) {
  mkdirSync(root, { recursive: true });
  const plugins = Object.fromEntries(Object.entries(entries).map(([key, installPath]) => [
    key, [{ scope: 'user', installPath, version: '1.0.0' }],
  ]));
  writeFileSync(join(root, 'installed_plugins.json'), JSON.stringify({ plugins }));
}

test('seed dirs add plugins; the primary root wins a key collision', async () => {
  const primary = tmp('dcc-primary-');
  const seed = tmp('dcc-seed-');
  writeInstalled(primary, { 'both@m': '/primary/both' });
  writeInstalled(seed, { 'both@m': '/seed/both', 'seeded@m': '/seed/seeded' });
  await withEnv({ CLAUDE_CODE_PLUGIN_SEED_DIR: seed }, () => {
    const byKey = Object.fromEntries(readInstalledClaudePlugins(primary).map((p) => [p.key, p.installPath]));
    assert.equal(byKey['both@m'], '/primary/both');
    assert.equal(byKey['seeded@m'], '/seed/seeded');
  });
});

test('a seed mounted at another path resolves content under the current seed root', async () => {
  const seed = tmp('dcc-seed-moved-');
  const cached = join(seed, 'cache', 'm', 'seeded', '1.0.0');
  mkdirSync(cached, { recursive: true });
  writeInstalled(seed, { 'seeded@m': '/build/time/seed/cache/m/seeded/1.0.0' });
  await withEnv({ CLAUDE_CODE_PLUGIN_SEED_DIR: seed }, () => {
    const found = readInstalledClaudePlugins(tmp('dcc-primary-')).find((p) => p.key === 'seeded@m');
    assert.equal(found.installPath, cached);
  });
});

test('an inline plugin replaces an installed plugin with the same manifest name', async () => {
  const primary = tmp('dcc-primary-');
  const installedDir = tmp('dcc-installed-');
  mkdirSync(join(installedDir, '.claude-plugin'), { recursive: true });
  writeFileSync(join(installedDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'shared' }));
  writeInstalled(primary, { 'entry-name@m': installedDir, 'other@m': '/other' });
  const inlineDir = tmp('dcc-inline-');
  mkdirSync(join(inlineDir, '.claude-plugin'), { recursive: true });
  writeFileSync(join(inlineDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'shared' }));
  await withEnv({ CLAUDE_CODE_PLUGIN_DIRS: inlineDir }, () => {
    const keys = readInstalledClaudePlugins(primary).map((p) => p.key).sort();
    assert.deepEqual(keys, ['other@m', 'shared@inline']);
  });
});

test('CLAUDE_CODE_PLUGIN_DIRS loads each directory as an inline plugin', async () => {
  const plugin = tmp('dcc-inline-');
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
  writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'inline-one' }));
  await withEnv({ CLAUDE_CODE_PLUGIN_DIRS: plugin }, () => {
    const found = readInstalledClaudePlugins(tmp('dcc-primary-')).find((p) => p.name === 'inline-one');
    assert.ok(found, 'inline plugin listed');
    assert.equal(found.installPath, plugin);
  });
});

async function captureWarnings(fn) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try { await fn(); } finally { console.warn = original; }
  return warnings;
}

test('a missing or non-directory PLUGIN_DIRS entry warns once and is skipped', async () => {
  const file = join(tmp('dcc-file-'), 'not-a-dir');
  writeFileSync(file, 'x');
  const missing = join(tmp('dcc-gone-'), 'missing-dir');
  const warnings = await captureWarnings(() => withEnv(
    { CLAUDE_CODE_PLUGIN_DIRS: [file, missing].join(delimiter) },
    () => {
      const primary = tmp('dcc-primary-');
      assert.deepEqual(readInstalledClaudePlugins(primary), []);
      assert.deepEqual(readInstalledClaudePlugins(primary), []);
    },
  ));
  assert.equal(warnings.length, 2, 'one warning per bad entry, not one per read');
});

test('a malformed inline manifest warns and keeps the directory name', async () => {
  const dir = join(tmp('dcc-bad-'), 'dir-named-plugin');
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), '{ "name": "x", }');
  const warnings = await captureWarnings(() => withEnv({ CLAUDE_CODE_PLUGIN_DIRS: dir }, () => {
    const plugins = readInstalledClaudePlugins(tmp('dcc-primary-'));
    assert.equal(plugins[0].name, 'dir-named-plugin');
  }));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /cannot read plugin manifest/);
});

test('a broken seed root warns; a missing primary root stays silent', async () => {
  const seed = tmp('dcc-seed-');
  writeFileSync(join(seed, 'installed_plugins.json'), '{ not json');
  const warnings = await captureWarnings(() => withEnv({ CLAUDE_CODE_PLUGIN_SEED_DIR: seed }, () => {
    assert.deepEqual(readInstalledClaudePlugins(tmp('dcc-empty-primary-')), []);
  }));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /installed_plugins\.json/);
});

test('property: arbitrary installed_plugins.json content never throws and returns well-formed records', async () => {
  const next = rng(300);
  const pick = (items) => items[Math.floor(next() * items.length)];
  const values = () => pick([null, 1, 'text', [], {}, { plugins: null }, { plugins: [] }, { plugins: { 'k@m': 'x' } },
    { plugins: { 'k@m': [{ scope: 'user', installPath: 5 }] } },
    { plugins: { 'a@b@c': [{ scope: 'user', installPath: '/p', version: 3 }] } },
    { plugins: { plain: [{ scope: 'project', installPath: '/p' }, { scope: 'user', installPath: '/q' }] } }]);
  for (let run = 0; run < 100; run += 1) {
    const root = tmp('dcc-fuzz-');
    writeFileSync(join(root, 'installed_plugins.json'), JSON.stringify(values()));
    await withEnv({}, () => {
      const plugins = readInstalledClaudePlugins(root);
      assert.ok(Array.isArray(plugins));
      for (const p of plugins) {
        for (const field of ['key', 'name', 'marketplace', 'installPath', 'version']) {
          assert.equal(typeof p[field], 'string');
        }
        if (p.key.includes('@') && !p.key.startsWith('@')) assert.equal(`${p.name}@${p.marketplace}`, p.key);
      }
    });
  }
});

test('property: each key appears once and comes from the first source that has it', async () => {
  const next = rng(400);
  const keys = ['a@m', 'b@m', 'c@m', 'd@m'];
  for (let run = 0; run < 100; run += 1) {
    const primary = tmp('dcc-p-');
    const seed = tmp('dcc-s-');
    const pick = (label) => Object.fromEntries(keys.filter(() => next() < 0.5).map((k) => [k, `/${label}/${k}`]));
    const primaryEntries = pick('primary');
    const seedEntries = pick('seed');
    writeInstalled(primary, primaryEntries);
    writeInstalled(seed, seedEntries);
    await withEnv({ CLAUDE_CODE_PLUGIN_SEED_DIR: seed }, () => {
      const plugins = readInstalledClaudePlugins(primary);
      const seen = plugins.map((p) => p.key);
      assert.equal(new Set(seen).size, seen.length, 'no duplicate keys');
      for (const p of plugins) {
        assert.equal(p.installPath, primaryEntries[p.key] ?? seedEntries[p.key]);
      }
      const expected = new Set([...Object.keys(primaryEntries), ...Object.keys(seedEntries)]);
      assert.deepEqual(new Set(seen), expected);
    });
  }
});

// ─── /cc-plugin honors the plugin config ─────────────────────────────────────

test('runPluginCommand disk fallback reads the configured plugins root', async () => {
  const root = tmp('dcc-cfgroot-');
  writeInstalled(root, { 'cfg-plugin@market': '/cfg/plugin' });
  const failingCli = async () => ({ ok: false, error: 'spawn claude ENOENT' });
  const text = await withEnv({}, () => runPluginCommand('list', {
    claude: failingCli,
    config: { pluginsRoot: root, userClaudeDir: tmp('dcc-user-') },
  }));
  assert.match(text, /cfg-plugin@market/);
});

// ─── review fixes: warnings, traversal, validation scope ─────────────────────

function writeManifest(dir, content) {
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), content);
}

test('a malformed installed plugin.json warns and falls back to the key name', async () => {
  const primary = tmp('dcc-primary-');
  const installed = tmp('dcc-bad-installed-');
  writeManifest(installed, '{ not json');
  writeInstalled(primary, { 'broken@m': installed });
  const warnings = await captureWarnings(() => withEnv({}, () => {
    assert.equal(readInstalledClaudePlugins(primary)[0].name, 'broken');
  }));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /cannot read plugin manifest.*Using "broken"/);
});

test('an inline plugin that replaces an installed plugin is reported once', async () => {
  const primary = tmp('dcc-primary-');
  const installed = tmp('dcc-installed-');
  const inline = tmp('dcc-inline-');
  writeManifest(installed, JSON.stringify({ name: 'dup' }));
  writeManifest(inline, JSON.stringify({ name: 'dup' }));
  writeInstalled(primary, { 'dup@m': installed });
  const warnings = await captureWarnings(() => withEnv({ CLAUDE_CODE_PLUGIN_DIRS: inline }, () => {
    readInstalledClaudePlugins(primary);
    readInstalledClaudePlugins(primary);
  }));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], new RegExp(`${inline}.*replaces installed plugin dup@m`));
});

test('an installed_plugins.json without a plugins object is reported', async () => {
  const primary = tmp('dcc-primary-');
  mkdirSync(primary, { recursive: true });
  writeFileSync(join(primary, 'installed_plugins.json'), '["wrong shape"]');
  const warnings = await captureWarnings(() => withEnv({}, () => {
    assert.deepEqual(readInstalledClaudePlugins(primary), []);
  }));
  assert.match(warnings.join('\n'), /has no "plugins" object/);
});

test('a seed record cannot point the cache lookup outside <seed>/cache', async () => {
  const seed = tmp('dcc-seed-escape-');
  mkdirSync(join(seed, 'escape'), { recursive: true });
  const record = (version) => [{ scope: 'user', installPath: '/recorded/path', version }];
  writeFileSync(join(seed, 'installed_plugins.json'), JSON.stringify({
    plugins: { 'p@m': record('../../../escape'), 'q@m': record('a/b'), 'r@m': record('..') },
  }));
  await withEnv({ CLAUDE_CODE_PLUGIN_SEED_DIR: seed }, async () => {
    await captureWarnings(() => {
      for (const plugin of readInstalledClaudePlugins(tmp('dcc-primary-'))) {
        assert.equal(plugin.installPath, '/recorded/path', plugin.key);
      }
    });
  });
});

test('a seed plugin missing at both paths is reported', async () => {
  const seed = tmp('dcc-seed-missing-');
  writeInstalled(seed, { 'gone@m': '/nowhere/dcc-gone' });
  const warnings = await captureWarnings(() => withEnv({ CLAUDE_CODE_PLUGIN_SEED_DIR: seed }, () => {
    readInstalledClaudePlugins(tmp('dcc-primary-'));
  }));
  assert.match(warnings.join('\n'), /seed plugin gone@m not found at .* or \/nowhere\/dcc-gone/);
});

test('a CLAUDE_CODE_PLUGIN_DIRS entry that cannot be read is skipped with a reason', async (t) => {
  if (process.platform === 'win32' || process.getuid?.() === 0) return t.skip('needs POSIX permissions');
  const parent = tmp('dcc-locked-');
  const child = join(parent, 'plugin');
  mkdirSync(child);
  chmodSync(parent, 0o000);
  try {
    const warnings = await captureWarnings(() => withEnv({ CLAUDE_CODE_PLUGIN_DIRS: child }, () => {
      assert.deepEqual(readInstalledClaudePlugins(tmp('dcc-primary-')), []);
    }));
    assert.match(warnings.join('\n'), /cannot be read, skipped.*EACCES/);
  } finally {
    chmodSync(parent, 0o700);
  }
});

test('the seed variable is not validated when plugins are disabled', async () => {
  await withEnv({ CLAUDE_CODE_PLUGIN_SEED_DIR: 'relative' }, () => {
    assert.throws(() => validateClaudeLocationEnv({}), /CLAUDE_CODE_PLUGIN_SEED_DIR/);
    validateClaudeLocationEnv({ enablePlugins: false });
  });
});

// ─── properties: seeded generators, no extra dependency ──────────────────────

test('property: envPluginDirs splits every non-blank entry into dirs or skipped, in order', async () => {
  const next = rng(300);
  const kinds = [
    () => randomAbsolute(next),
    () => `~/${randomSegment(next)}`,
    () => '~',
    () => randomSegment(next).replace(/^[.~]+/, 'r'),
  ];
  for (let run = 0; run < 200; run += 1) {
    const entries = Array.from({ length: Math.floor(next() * 6) }, () => kinds[Math.floor(next() * kinds.length)]());
    const raw = entries.flatMap((e) => (next() < 0.3 ? ['', e] : [e])).join(delimiter);
    await withEnv({ CLAUDE_CODE_PLUGIN_DIRS: raw }, () => {
      const { dirs, skipped } = envPluginDirs();
      const expectedDirs = entries.filter((e) => e.startsWith('/') || e === '~' || e.startsWith('~/'));
      const expectedSkipped = entries.filter((e) => !expectedDirs.includes(e));
      assert.equal(dirs.length, expectedDirs.length, raw);
      assert.deepEqual(skipped, expectedSkipped, raw);
      assert.ok(dirs.every((d) => d.startsWith('/')), raw);
    });
  }
});

test('property: envPathList rejects a list that holds one relative entry, wherever it sits', async () => {
  const next = rng(400);
  for (let run = 0; run < 100; run += 1) {
    const list = Array.from({ length: 1 + Math.floor(next() * 4) }, () => randomAbsolute(next));
    list.splice(Math.floor(next() * (list.length + 1)), 0, `rel${randomSegment(next)}`);
    await withEnv({ CLAUDE_CODE_PLUGIN_SEED_DIR: list.join(delimiter) }, () => {
      assert.throws(() => envPathList('CLAUDE_CODE_PLUGIN_SEED_DIR'), /CLAUDE_CODE_PLUGIN_SEED_DIR.*absolute/);
    });
  }
});

test('property: the derived project folder uses only dashes and alphanumerics', () => {
  const next = rng(500);
  const alphabet = 'abcXYZ019/._ ~日é-';
  for (let run = 0; run < 300; run += 1) {
    const length = 1 + Math.floor(next() * 260);
    const cwd = `/${Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)]).join('')}`;
    const folder = claudeProjectFolder(cwd);
    assert.match(folder, /^[A-Za-z0-9-]+$/, cwd);
    assert.equal(folder, claudeProjectFolder(cwd), 'deterministic');
    const plain = cwd.replace(/[^a-zA-Z0-9]/g, '-');
    if (plain.length <= 200) assert.equal(folder, plain);
    else {
      assert.ok(folder.startsWith(plain.slice(0, 200)));
      assert.match(folder.slice(200), /^-[0-9a-z]+$/);
    }
  }
});

test('property: the project dir name applies exactly when it matches the documented rule', async () => {
  const next = rng(600);
  const alphabet = 'abcXYZ019_-./ ';
  const rule = /^[A-Za-z0-9_-]{1,64}$/;
  const device = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
  for (let run = 0; run < 300; run += 1) {
    const length = Math.floor(next() * 70);
    let name = Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)]).join('');
    if (next() < 0.1) name = ['con', 'LPT1', 'Nul'][Math.floor(next() * 3)];
    const valid = rule.test(name) && !device.test(name);
    await withEnv({ CLAUDE_CONFIG_DIR: '/cfg', CLAUDE_CODE_PROJECT_DIR_NAME: name }, () => {
      const expected = valid ? name : '-a-b';
      assert.equal(claudeProjectsDir('/a/b'), join('/cfg', 'projects', expected), JSON.stringify(name));
    });
  }
});

test('property: manifest names decide the plugin name, never a throw', async () => {
  const next = rng(700);
  const bodies = [
    (n) => JSON.stringify({ name: n }),
    () => JSON.stringify({ name: 42 }),
    () => JSON.stringify({ name: '' }),
    () => JSON.stringify({}),
    () => JSON.stringify([1, 2]),
    () => '{ broken',
    () => 'null',
  ];
  await captureWarnings(async () => {
    for (let run = 0; run < 60; run += 1) {
      const dir = tmp('dcc-prop-manifest-');
      const wanted = `n${randomSegment(next).replace(/[^A-Za-z0-9]/g, 'x')}`;
      const pick = Math.floor(next() * bodies.length);
      writeManifest(dir, bodies[pick](wanted));
      await withEnv({ CLAUDE_CODE_PLUGIN_DIRS: dir }, () => {
        const [plugin] = readInstalledClaudePlugins(tmp('dcc-primary-'));
        const fallback = dir.split('/').at(-1);
        assert.equal(plugin.name, pick === 0 ? wanted : fallback, bodies[pick](wanted));
      });
    }
  });
});

test('property: inline plugins replace exactly the installed plugins with the same manifest name', async () => {
  const next = rng(800);
  await captureWarnings(async () => {
    for (let run = 0; run < 40; run += 1) {
      const primary = tmp('dcc-prop-primary-');
      const names = ['a', 'b', 'c', 'd'].map((n) => `${n}${run}`);
      const installed = {};
      for (const name of names) {
        const dir = tmp('dcc-prop-installed-');
        writeManifest(dir, JSON.stringify({ name }));
        installed[`${name}@m`] = dir;
      }
      writeInstalled(primary, installed);
      const inlineNames = names.filter(() => next() < 0.5);
      const inlineDirs = inlineNames.map((name) => {
        const dir = tmp('dcc-prop-inline-');
        writeManifest(dir, JSON.stringify({ name }));
        return dir;
      });
      await withEnv({ CLAUDE_CODE_PLUGIN_DIRS: inlineDirs.join(delimiter) }, () => {
        const keys = readInstalledClaudePlugins(primary).map((p) => p.key);
        assert.equal(new Set(keys).size, keys.length, 'keys are unique');
        for (const name of names) {
          assert.equal(keys.includes(`${name}@m`), !inlineNames.includes(name), name);
          assert.equal(keys.includes(`${name}@inline`), inlineNames.includes(name), name);
        }
      });
    }
  });
});
