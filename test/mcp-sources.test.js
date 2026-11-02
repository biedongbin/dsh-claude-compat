// MCP source loading (src/mcp.js loadMcpServers): which files load, which entry wins,
// and how each entry is translated. Real files in a temp folder; no DSH services.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadMcpServers, withoutDuplicateUrls } from '../src/mcp.js';

// Temp folders live under the gitignored .tmp/ of the repo.
function tempDir(prefix) {
  mkdirSync(join(process.cwd(), '.tmp'), { recursive: true });
  return mkdtempSync(join(process.cwd(), '.tmp', prefix));
}

// A fixture home with a user config dir, a project (a folder with .git), and a managed folder.
function fixture() {
  const root = tempDir('dcc-mcp-');
  const userDir = join(root, 'claude');
  const project = join(root, 'proj');
  const managedDir = join(root, 'managed');
  for (const dir of [userDir, join(project, '.git'), join(project, '.claude'), managedDir]) mkdirSync(dir, { recursive: true });
  return { userDir, project, managedDir, config: { projectRootMarkers: ['.git'], userClaudeDir: userDir } };
}

function write(path, value) {
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
}

async function load(fx) {
  return loadMcpServers(fx.config, { cwd: fx.project, managedDir: fx.managedDir });
}

const names = (result) => result.servers.map((s) => s.serverName).sort();
const stdio = (command) => ({ type: 'stdio', command, args: [] });

test('user servers load from the top level of .claude.json', async () => {
  const fx = fixture();
  write(join(fx.userDir, '.claude.json'), { mcpServers: { mem: stdio('mem-server') } });
  const result = await load(fx);
  assert.deepEqual(names(result), ['mem']);
  assert.equal(result.servers[0].command, 'mem-server');
});

test('a server with no type and a url is skipped, as Claude Code skips it', async () => {
  const fx = fixture();
  write(join(fx.project, '.mcp.json'), { mcpServers: { api: { url: 'https://x.example/mcp' } } });
  const result = await load(fx);
  assert.deepEqual(names(result), []);
  assert.match(result.warns.join('\n'), /"type": "http"/);
});

test('sse and ws entries are skipped with a warning, and http entries mount', async () => {
  const fx = fixture();
  write(join(fx.project, '.mcp.json'), { mcpServers: {
    old: { type: 'sse', url: 'https://a.example/sse' },
    sock: { type: 'ws', url: 'wss://b.example/ws' },
    web: { type: 'http', url: 'https://c.example/mcp' },
  } });
  const result = await load(fx);
  assert.deepEqual(names(result), ['web']);
  assert.equal(result.servers[0].transport, 'streamable-http');
  assert.match(result.warns.join('\n'), /type 'sse' is not supported/);
  assert.match(result.warns.join('\n'), /type 'ws' is not supported/);
});

test('a local entry for this project beats project and user entries of the same name', async () => {
  const fx = fixture();
  write(join(fx.userDir, '.claude.json'), {
    mcpServers: { shared: stdio('user-cmd') },
    projects: { [fx.project]: { mcpServers: { shared: stdio('local-cmd') } } },
  });
  write(join(fx.project, '.mcp.json'), { mcpServers: { shared: stdio('project-cmd') } });
  const result = await load(fx);
  assert.deepEqual(result.servers.map((s) => s.command), ['local-cmd']);
});

test('a project entry beats a user entry of the same name', async () => {
  const fx = fixture();
  write(join(fx.userDir, '.claude.json'), { mcpServers: { shared: stdio('user-cmd') } });
  write(join(fx.project, '.mcp.json'), { mcpServers: { shared: stdio('project-cmd') } });
  const result = await load(fx);
  assert.deepEqual(result.servers.map((s) => s.command), ['project-cmd']);
});

test('the local list is keyed by the launch folder, so another folder does not see it', async () => {
  const fx = fixture();
  write(join(fx.userDir, '.claude.json'), { projects: { '/some/other/folder': { mcpServers: { x: stdio('x') } } } });
  assert.deepEqual(names(await load(fx)), []);
});

test('managed-mcp.json takes exclusive control: project and user servers do not load', async () => {
  const fx = fixture();
  write(join(fx.managedDir, 'managed-mcp.json'), { mcpServers: { corp: stdio('corp-cmd') } });
  write(join(fx.userDir, '.claude.json'), { mcpServers: { mem: stdio('mem') } });
  write(join(fx.project, '.mcp.json'), { mcpServers: { proj: stdio('proj') } });
  const result = await load(fx);
  assert.deepEqual(names(result), ['corp']);
  assert.equal(result.exclusive, true);
});

test('an empty managed-mcp.json turns every MCP server off', async () => {
  const fx = fixture();
  write(join(fx.managedDir, 'managed-mcp.json'), { mcpServers: {} });
  write(join(fx.userDir, '.claude.json'), { mcpServers: { mem: stdio('mem') } });
  assert.deepEqual(names(await load(fx)), []);
});

test('an unreadable managed-mcp.json fails closed: the others stay off and a warning names it', async () => {
  const fx = fixture();
  write(join(fx.managedDir, 'managed-mcp.json'), '{ not json');
  write(join(fx.userDir, '.claude.json'), { mcpServers: { mem: stdio('mem') } });
  const result = await load(fx);
  assert.deepEqual(names(result), []);
  assert.match(result.warns.join('\n'), /managed-mcp\.json: invalid JSON/);
});

test('managedMcpServers beats a project entry of the same name', async () => {
  const fx = fixture();
  write(join(fx.managedDir, 'managed-settings.json'), { managedMcpServers: { shared: { type: 'http', url: 'https://corp.example/mcp' } } });
  write(join(fx.project, '.mcp.json'), { mcpServers: { shared: stdio('project-cmd') } });
  const result = await load(fx);
  assert.deepEqual(result.servers.map((s) => s.transport), ['streamable-http']);
});

test('managedMcpServers in a user settings file is ignored with a warning', async () => {
  const fx = fixture();
  write(join(fx.userDir, 'settings.json'), { managedMcpServers: { sneaky: { type: 'http', url: 'https://x.example/mcp' } } });
  const result = await load(fx);
  assert.deepEqual(names(result), []);
  assert.match(result.warns.join('\n'), /read from managed settings only/);
});

test('disabledMcpjsonServers in a settings file turns off a project server', async () => {
  const fx = fixture();
  write(join(fx.project, '.mcp.json'), { mcpServers: { keep: stdio('k'), drop: stdio('d') } });
  write(join(fx.project, '.claude', 'settings.local.json'), { disabledMcpjsonServers: ['drop'] });
  assert.deepEqual(names(await load(fx)), ['keep']);
});

test('disabledMcpServers for this project turns off a user server, but not a project server', async () => {
  const fx = fixture();
  write(join(fx.userDir, '.claude.json'), {
    mcpServers: { userOne: stdio('u') },
    projects: { [fx.project]: { disabledMcpServers: ['userOne', 'projOne'] } },
  });
  write(join(fx.project, '.mcp.json'), { mcpServers: { projOne: stdio('p') } });
  assert.deepEqual(names(await load(fx)), ['projOne']);
});

test('timeout sets the per-call limit, and a value under one second falls back with a warning', async () => {
  const fx = fixture();
  write(join(fx.userDir, '.claude.json'), { mcpServers: {
    slow: { ...stdio('s'), timeout: 300000 },
    fast: { ...stdio('f'), timeout: 5 },
  } });
  const result = await load(fx);
  const byName = Object.fromEntries(result.servers.map((s) => [s.serverName, s.toolCallTimeoutMs]));
  assert.deepEqual(byName, { slow: 300000, fast: 60000 });
  assert.match(result.warns.join('\n'), /timeout must be at least 1000 ms/);
});

test('${VAR} and ${VAR:-default} expand in command, args, url and headers', async () => {
  const fx = fixture();
  process.env.DCC_TEST_HOST = 'api.example';
  delete process.env.DCC_TEST_UNSET;
  try {
    write(join(fx.project, '.mcp.json'), { mcpServers: {
      cmd: { type: 'stdio', command: '${DCC_TEST_HOST}-cmd', args: ['${DCC_TEST_UNSET:-fallback}'] },
      web: { type: 'http', url: 'https://${DCC_TEST_HOST}/mcp', headers: { 'X-Key': '${DCC_TEST_UNSET:-none}' } },
    } });
    const result = await load(fx);
    const byName = Object.fromEntries(result.servers.map((s) => [s.serverName, s]));
    assert.equal(byName.cmd.command, 'api.example-cmd');
    assert.deepEqual(byName.cmd.args, ['fallback']);
    assert.equal(byName.web.url, 'https://api.example/mcp');
    assert.deepEqual(byName.web.headers, { 'X-Key': 'none' });
  } finally {
    delete process.env.DCC_TEST_HOST;
  }
});

test('an unset variable with no default keeps the literal text and warns with its name', async () => {
  const fx = fixture();
  delete process.env.DCC_TEST_MISSING;
  write(join(fx.project, '.mcp.json'), { mcpServers: { cmd: { type: 'stdio', command: 'run-${DCC_TEST_MISSING}' } } });
  const result = await load(fx);
  assert.equal(result.servers[0].command, 'run-${DCC_TEST_MISSING}');
  assert.match(result.warns.join('\n'), /\$\{DCC_TEST_MISSING\} is not set/);
});

test('a stdio server gets CLAUDE_PROJECT_DIR in its environment', async () => {
  const fx = fixture();
  write(join(fx.project, '.mcp.json'), { mcpServers: { cmd: stdio('c') } });
  const result = await load(fx);
  assert.equal(result.servers[0].env.CLAUDE_PROJECT_DIR, fx.project);
});

test('headersHelper output is merged into the headers, and it overrides a static header', async () => {
  const fx = fixture();
  const helper = `"${process.execPath}" -e 'process.stdout.write(JSON.stringify({"Authorization":"Bearer t"}))'`;
  write(join(fx.project, '.mcp.json'), { mcpServers: { api: {
    type: 'http', url: 'https://a.example/mcp', headers: { Authorization: 'static', 'X-Keep': 'yes' }, headersHelper: helper,
  } } });
  const result = await load(fx);
  assert.deepEqual(result.servers[0].headers, { Authorization: 'Bearer t', 'X-Keep': 'yes' });
});

test('a headersHelper that fails skips its server with a warning', async () => {
  const fx = fixture();
  write(join(fx.project, '.mcp.json'), { mcpServers: { api: {
    type: 'http', url: 'https://a.example/mcp', headersHelper: `"${process.execPath}" -e 'process.exit(3)'`,
  } } });
  const result = await load(fx);
  assert.deepEqual(names(result), []);
  assert.match(result.warns.join('\n'), /headersHelper command failed/);
});

test('a headersHelper that prints a non-object is skipped with a warning', async () => {
  const fx = fixture();
  write(join(fx.project, '.mcp.json'), { mcpServers: { api: {
    type: 'http', url: 'https://a.example/mcp', headersHelper: `"${process.execPath}" -e 'process.stdout.write("[1]")'`,
  } } });
  const result = await load(fx);
  assert.deepEqual(names(result), []);
  assert.match(result.warns.join('\n'), /not a JSON object/);
});

test('oauth and alwaysLoad are reported as unsupported, and the server still mounts', async () => {
  const fx = fixture();
  write(join(fx.project, '.mcp.json'), { mcpServers: { api: { type: 'http', url: 'https://a.example/mcp', oauth: {}, alwaysLoad: true } } });
  const result = await load(fx);
  assert.deepEqual(names(result), ['api']);
  assert.match(result.warns.join('\n'), /oauth is not supported/);
  assert.match(result.warns.join('\n'), /alwaysLoad is not supported/);
});

test('a denied server name stays off, whatever its source', async () => {
  const fx = fixture();
  write(join(fx.userDir, '.claude.json'), { mcpServers: { bad: stdio('b'), good: stdio('g') } });
  write(join(fx.userDir, 'settings.json'), { deniedMcpServers: [{ serverName: 'bad' }] });
  assert.deepEqual(names(await load(fx)), ['good']);
});

test('an allowlist of URLs blocks a stdio server, and managed-settings servers skip the allowlist', async () => {
  const fx = fixture();
  write(join(fx.managedDir, 'managed-settings.json'), {
    allowedMcpServers: [{ serverUrl: 'https://ok.example/*' }],
    managedMcpServers: { corp: { type: 'http', url: 'https://corp.example/mcp' } },
  });
  write(join(fx.project, '.mcp.json'), { mcpServers: { local: stdio('l'), ok: { type: 'http', url: 'https://ok.example/mcp' } } });
  const result = await load(fx);
  assert.deepEqual(names(result), ['corp', 'ok']);
  assert.match(result.warns.join('\n'), /local: not allowed by policy/);
});

test('allowManagedMcpServersOnly ignores a user allowlist', async () => {
  const fx = fixture();
  write(join(fx.managedDir, 'managed-settings.json'), { allowManagedMcpServersOnly: true, allowedMcpServers: [{ serverName: 'only-this' }] });
  write(join(fx.userDir, 'settings.json'), { allowedMcpServers: [{ serverName: 'mine' }] });
  write(join(fx.userDir, '.claude.json'), { mcpServers: { mine: stdio('m') } });
  // The managed list allows only "only-this", so "mine" is blocked despite the user allowlist.
  assert.deepEqual(names(await load(fx)), []);
});

test('withoutDuplicateUrls drops a plugin server whose URL a higher source already uses', () => {
  const higher = [{ serverName: 'a', url: 'https://x.example/mcp' }];
  const plugin = [{ serverName: 'b', url: 'https://x.example/mcp' }, { serverName: 'c', url: 'https://y.example/mcp' }, { serverName: 'd' }];
  assert.deepEqual(withoutDuplicateUrls(higher, plugin, []).map((s) => s.serverName), ['c', 'd']);
});
