// Env-var redirection of Claude Code default locations (issue #1). Hermetic:
// every test clears and restores the location variables and uses temp dirs.
// Property tests use a seeded generator, so a failure reproduces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import {
  claudeProjectsDir,
  envPathList,
  resolveClaudePluginsRoot,
  resolveUserClaudeDir,
  validateClaudeLocationEnv,
} from '../src/lib.js';
import { readInstalledClaudePlugins } from '../src/plugins.js';
import { runPluginCommand } from '../src/plugin-manager.js';
import { apply } from '../src/index.js';
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

test('a project dir name that is not one folder name is rejected', async () => {
  for (const bad of ['..', '.', '../other', 'a/b']) {
    await withEnv({ CLAUDE_CODE_PROJECT_DIR_NAME: bad }, () => {
      assert.throws(() => claudeProjectsDir('/a/b'), /CLAUDE_CODE_PROJECT_DIR_NAME/, bad);
    });
  }
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
