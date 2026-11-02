// Env-var redirection of Claude Code default locations (issue #1). Hermetic:
// every test sets and restores its own env vars and uses temp dirs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import {
  claudeJsonPath,
  claudeProjectsDir,
  parsePathList,
  resolveClaudePluginsRoot,
  resolveUserClaudeDir,
} from '../src/lib.js';
import { readInstalledClaudePlugins } from '../src/plugins.js';

const VARS = [
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_PLUGIN_CACHE_DIR',
  'CLAUDE_CODE_PLUGIN_SEED_DIR',
  'CLAUDE_CODE_PLUGIN_DIRS',
  'CLAUDE_CODE_PROJECT_DIR_NAME',
];

function withEnv(env, fn) {
  const saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
  Object.assign(process.env, env);
  try { return fn(); } finally {
    for (const k of VARS) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

const tmp = (p) => mkdtempSync(join(tmpdir(), p));

test('CLAUDE_CONFIG_DIR replaces ~/.claude when no explicit dir is given', () => {
  const dir = tmp('dcc-cfg-');
  withEnv({ CLAUDE_CONFIG_DIR: dir }, () => {
    assert.equal(resolveUserClaudeDir(undefined), dir);
    assert.equal(resolveUserClaudeDir(''), dir);
  });
});

test('explicit userClaudeDir wins over CLAUDE_CONFIG_DIR', () => {
  const explicit = tmp('dcc-explicit-');
  withEnv({ CLAUDE_CONFIG_DIR: tmp('dcc-cfg-') }, () => {
    assert.equal(resolveUserClaudeDir(explicit), explicit);
  });
});

test('default is ~/.claude when nothing is set', () => {
  withEnv({}, () => {
    assert.equal(resolveUserClaudeDir(undefined), join(homedir(), '.claude'));
  });
});

test('empty CLAUDE_CONFIG_DIR is ignored', () => {
  withEnv({ CLAUDE_CONFIG_DIR: '' }, () => {
    assert.equal(resolveUserClaudeDir(undefined), join(homedir(), '.claude'));
  });
});

test('relative CLAUDE_CONFIG_DIR fails fast with the variable name', () => {
  withEnv({ CLAUDE_CONFIG_DIR: 'relative/dir' }, () => {
    assert.throws(() => resolveUserClaudeDir(undefined), /CLAUDE_CONFIG_DIR.*absolute/);
  });
});

test('plugins root: explicit > CLAUDE_CODE_PLUGIN_CACHE_DIR > <config>/plugins', () => {
  const cfg = tmp('dcc-cfg-');
  const cache = tmp('dcc-cache-');
  const explicit = tmp('dcc-explicit-');
  withEnv({ CLAUDE_CONFIG_DIR: cfg }, () => {
    assert.equal(resolveClaudePluginsRoot(undefined), join(cfg, 'plugins'));
  });
  withEnv({ CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_PLUGIN_CACHE_DIR: cache }, () => {
    assert.equal(resolveClaudePluginsRoot(undefined), cache);
    assert.equal(resolveClaudePluginsRoot(explicit), explicit);
  });
});

test('.claude.json lives in CLAUDE_CONFIG_DIR when set, else in home', () => {
  const cfg = tmp('dcc-cfg-');
  withEnv({ CLAUDE_CONFIG_DIR: cfg }, () => {
    assert.equal(claudeJsonPath(), join(cfg, '.claude.json'));
  });
  withEnv({}, () => {
    assert.equal(claudeJsonPath(), join(homedir(), '.claude.json'));
  });
});

test('projects dir honors CLAUDE_CODE_PROJECT_DIR_NAME only with a name set', () => {
  const cfg = tmp('dcc-cfg-');
  withEnv({ CLAUDE_CONFIG_DIR: cfg }, () => {
    assert.equal(claudeProjectsDir('/a/b'), join(cfg, 'projects', '-a-b'));
  });
  withEnv({ CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_PROJECT_DIR_NAME: 'shared' }, () => {
    assert.equal(claudeProjectsDir('/a/b'), join(cfg, 'projects', 'shared'));
  });
});

test('parsePathList splits on the platform delimiter and drops blanks', () => {
  assert.deepEqual(parsePathList(undefined), []);
  assert.deepEqual(parsePathList(''), []);
  assert.deepEqual(parsePathList(`/a${delimiter}${delimiter}/b`), ['/a', '/b']);
});

function writeInstalled(root, key, installPath) {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'installed_plugins.json'),
    JSON.stringify({ plugins: { [key]: [{ scope: 'user', installPath, version: '1.0.0' }] } }),
  );
}

test('seed dirs add plugins; the primary root wins a key collision', () => {
  const primary = tmp('dcc-primary-');
  const seed = tmp('dcc-seed-');
  writeInstalled(primary, 'both@m', '/primary/both');
  writeInstalled(seed, 'both@m', '/seed/both');
  writeInstalled(seed, 'seeded@m', '/seed/seeded');
  withEnv({ CLAUDE_CODE_PLUGIN_SEED_DIR: seed }, () => {
    const plugins = readInstalledClaudePlugins(primary);
    const byKey = Object.fromEntries(plugins.map((p) => [p.key, p.installPath]));
    assert.equal(byKey['both@m'], '/primary/both');
    assert.equal(byKey['seeded@m'], '/seed/seeded');
  });
});

test('CLAUDE_CODE_PLUGIN_DIRS loads each directory as an inline plugin', () => {
  const primary = tmp('dcc-primary-');
  const plugin = tmp('dcc-inline-');
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
  writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'inline-one' }));
  withEnv({ CLAUDE_CODE_PLUGIN_DIRS: plugin }, () => {
    const found = readInstalledClaudePlugins(primary).find((p) => p.name === 'inline-one');
    assert.ok(found, 'inline plugin listed');
    assert.equal(found.installPath, plugin);
  });
});

test('a missing PLUGIN_DIRS entry is skipped, not fatal', () => {
  withEnv({ CLAUDE_CODE_PLUGIN_DIRS: '/no/such/plugin/dir' }, () => {
    assert.deepEqual(readInstalledClaudePlugins(tmp('dcc-primary-')), []);
  });
});
