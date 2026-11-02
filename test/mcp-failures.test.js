// Failure paths of the MCP loader: broken files fail closed, a malformed field or
// policy entry is reported and skipped, and plugin servers obey the same policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyPolicy, extraServers, loadMcpServers, translateMcpServers, withoutDuplicateUrls } from '../src/mcp.js';

function tempDir(prefix) {
  mkdirSync(join(process.cwd(), '.tmp'), { recursive: true });
  return mkdtempSync(join(process.cwd(), '.tmp', prefix));
}

function fixture() {
  const root = tempDir('dcc-mcp-fail-');
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

test('an unreadable managed-settings.json turns every MCP server off, and says so', async () => {
  const fx = fixture();
  write(join(fx.managedDir, 'managed-settings.json'), '{ broken');
  write(join(fx.userDir, '.claude.json'), { mcpServers: { mine: stdio('m') } });
  write(join(fx.project, '.mcp.json'), { mcpServers: { proj: stdio('p') } });
  const result = await load(fx);
  assert.deepEqual(names(result), []);
  assert.match(result.warns.join('\n'), /managed-settings\.json: invalid JSON/);
  assert.match(result.warns.join('\n'), /Every MCP server is off/);
});

test('an unreadable .claude.json is reported, and the project servers still load', async () => {
  const fx = fixture();
  write(join(fx.userDir, '.claude.json'), '{ broken');
  write(join(fx.project, '.mcp.json'), { mcpServers: { proj: stdio('p') } });
  const result = await load(fx);
  assert.deepEqual(names(result), ['proj']);
  assert.match(result.warns.join('\n'), /\.claude\.json: invalid JSON/);
  assert.match(result.warns.join('\n'), /user and local MCP servers/);
});

test('a malformed project .mcp.json is reported with what it stops', async () => {
  const fx = fixture();
  write(join(fx.project, '.mcp.json'), '[1, 2]');
  const result = await load(fx);
  assert.deepEqual(names(result), []);
  assert.match(result.warns.join('\n'), /project MCP servers are not read/);
});

test('a managed-mcp.json whose mcpServers is not a map fails closed', async () => {
  const fx = fixture();
  write(join(fx.managedDir, 'managed-mcp.json'), { mcpServers: [] });
  write(join(fx.userDir, '.claude.json'), { mcpServers: { mine: stdio('m') } });
  const result = await load(fx);
  assert.deepEqual(names(result), []);
  assert.match(result.warns.join('\n'), /mcpServers must be an object/);
});

test('a managed-mcp.json problem still lets managedMcpServers load', async () => {
  const fx = fixture();
  write(join(fx.managedDir, 'managed-mcp.json'), '{ broken');
  write(join(fx.managedDir, 'managed-settings.json'), { managedMcpServers: { corp: { type: 'http', url: 'https://c.example/mcp' } } });
  const result = await load(fx);
  assert.deepEqual(names(result), ['corp']);
});

test('a non-string arg skips the entry, because the argument list would be wrong', async () => {
  const fx = fixture();
  write(join(fx.project, '.mcp.json'), { mcpServers: { bad: { type: 'stdio', command: 'c', args: ['--port', 3000] } } });
  const result = await load(fx);
  assert.deepEqual(names(result), []);
  assert.match(result.warns.join('\n'), /bad: args must be a list of strings, skipped/);
});

test('an object header value skips the entry and names the field', async () => {
  const fx = fixture();
  write(join(fx.project, '.mcp.json'), { mcpServers: { api: { type: 'http', url: 'https://a.example/mcp', headers: { X: { y: 1 } } } } });
  const result = await load(fx);
  assert.deepEqual(names(result), []);
  assert.match(result.warns.join('\n'), /api: headers must map names/);
});

test('a deniedMcpServers that is not a list is reported, and the rest of the policy still applies', async () => {
  const fx = fixture();
  write(join(fx.userDir, 'settings.json'), { deniedMcpServers: { serverName: 'x' } });
  write(join(fx.userDir, '.claude.json'), { mcpServers: { x: stdio('x') } });
  const result = await load(fx);
  assert.match(result.warns.join('\n'), /deniedMcpServers must be a list/);
});

test('a malformed policy entry is reported and ignored, and a valid one still denies', async () => {
  const fx = fixture();
  write(join(fx.userDir, 'settings.json'), { deniedMcpServers: [null, 'npx', { serverName: 'bad' }, { serverURL: 'x' }] });
  write(join(fx.userDir, '.claude.json'), { mcpServers: { bad: stdio('b'), good: stdio('g') } });
  const result = await load(fx);
  assert.deepEqual(names(result), ['good']);
  const warned = result.warns.join('\n');
  assert.match(warned, /deniedMcpServers\[0\]: not an object/);
  assert.match(warned, /deniedMcpServers\[1\]: not an object/);
  assert.match(warned, /deniedMcpServers\[3\]: needs exactly one/);
});

test('an allowlist that is not a list allows nothing, and says so', async () => {
  const fx = fixture();
  write(join(fx.userDir, 'settings.json'), { allowedMcpServers: { serverName: 'x' } });
  write(join(fx.userDir, '.claude.json'), { mcpServers: { x: stdio('x') } });
  const result = await load(fx);
  assert.deepEqual(names(result), []);
  assert.match(result.warns.join('\n'), /allowedMcpServers must be a list/);
});

test('allowManagedMcpServersOnly that is not a boolean is reported, and treated as false', async () => {
  const fx = fixture();
  write(join(fx.managedDir, 'managed-settings.json'), { allowManagedMcpServersOnly: 'true' });
  write(join(fx.userDir, 'settings.json'), { allowedMcpServers: [{ serverName: 'mine' }] });
  write(join(fx.userDir, '.claude.json'), { mcpServers: { mine: stdio('m') } });
  const result = await load(fx);
  assert.deepEqual(names(result), ['mine']);
  assert.match(result.warns.join('\n'), /allowManagedMcpServersOnly must be true or false/);
});

test('a headersHelper under an allowlist is refused, since the allowlist cannot see the helper', async () => {
  const fx = fixture();
  write(join(fx.userDir, 'settings.json'), { allowedMcpServers: [{ serverUrl: 'https://a.example/*' }] });
  write(join(fx.project, '.mcp.json'), { mcpServers: { api: {
    type: 'http', url: 'https://a.example/mcp', headersHelper: `"${process.execPath}" -e 'process.stdout.write("{}")'`,
  } } });
  const result = await load(fx);
  assert.deepEqual(names(result), []);
  assert.match(result.warns.join('\n'), /headersHelper is not run under an allowlist/);
});

test('an organization server may use a headersHelper under an allowlist', async () => {
  const fx = fixture();
  write(join(fx.managedDir, 'managed-settings.json'), { managedMcpServers: { corp: {
    type: 'http', url: 'https://c.example/mcp', headersHelper: `"${process.execPath}" -e 'process.stdout.write("{\\"X-A\\":\\"1\\"}")'`,
  } }, allowedMcpServers: [{ serverUrl: 'https://other.example/*' }] });
  const result = await load(fx);
  assert.deepEqual(names(result), ['corp']);
  assert.deepEqual(result.servers[0].headers, { 'X-A': '1' });
});

test('a headersHelper that prints a non-string value skips the server', async () => {
  const fx = fixture();
  write(join(fx.project, '.mcp.json'), { mcpServers: { api: {
    type: 'http', url: 'https://a.example/mcp', headersHelper: `"${process.execPath}" -e 'process.stdout.write("{\\"X\\":{}}")'`,
  } } });
  const result = await load(fx);
  assert.deepEqual(names(result), []);
  assert.match(result.warns.join('\n'), /not a string, number or boolean/);
});

test('plugin servers obey the policy: a denied URL is skipped with a reason', () => {
  const warns = [];
  const policy = { allowed: undefined, denied: [{ serverUrl: 'https://evil.example/*' }] };
  const kept = applyPolicy([
    { serverName: 'bad', url: 'https://evil.example/mcp' },
    { serverName: 'ok', url: 'https://good.example/mcp' },
  ], policy, warns);
  assert.deepEqual(kept.map((s) => s.serverName), ['ok']);
  assert.match(warns.join('\n'), /bad: denied by policy, skipped/);
});

test('a plugin server that duplicates a URL is reported when it is dropped', () => {
  const warns = [];
  const kept = withoutDuplicateUrls([{ url: 'https://x.example/mcp' }], [{ serverName: 'dup', url: 'https://x.example/mcp' }], warns);
  assert.deepEqual(kept, []);
  assert.match(warns.join('\n'), /dup: plugin server uses a URL/);
});

test('a plugin entry with a headersHelper is skipped, because the helper would never run', () => {
  const body = JSON.stringify({ mcpServers: { api: { type: 'http', url: 'https://p.example/mcp', headersHelper: 'x' } } });
  const result = translateMcpServers(body);
  assert.deepEqual(result.servers, []);
  assert.match(result.warns.join('\n'), /headersHelper is not run for plugin servers, skipped/);
});

test('extraServers drops a denied plugin server and a plugin URL that a loaded server uses', () => {
  const loaded = {
    servers: [{ serverName: 'mine', url: 'https://m.example/mcp' }],
    policy: { allowed: undefined, denied: [{ serverUrl: 'https://evil.example/*' }] },
    warns: [],
  };
  const plugin = [
    { serverName: 'bad', url: 'https://evil.example/mcp' },
    { serverName: 'dup', url: 'https://m.example/mcp' },
    { serverName: 'ok', url: 'https://p.example/mcp' },
  ];
  assert.deepEqual(extraServers(loaded, plugin).map((s) => s.serverName), ['ok']);
  assert.equal(loaded.warns.length, 2);
});
