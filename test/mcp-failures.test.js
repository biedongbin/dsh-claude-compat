// Failure paths of the MCP loader: broken files fail closed, a malformed field or
// policy entry is reported and skipped, and plugin servers obey the same policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPolicy, urlMatches } from '../src/mcp-policy.js';
import { translatePluginMcp } from '../src/plugins.js';
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

test('allowManagedMcpServersOnly that is not a boolean fails closed, and says so', async () => {
  const fx = fixture();
  write(join(fx.managedDir, 'managed-settings.json'), { allowManagedMcpServersOnly: 'true' });
  write(join(fx.userDir, 'settings.json'), { allowedMcpServers: [{ serverName: 'mine' }] });
  write(join(fx.userDir, '.claude.json'), { mcpServers: { mine: stdio('m') } });
  const result = await load(fx);
  assert.deepEqual(names(result), []);
  assert.match(result.warns.join('\n'), /Managed policy is malformed/);
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
  assert.deepEqual(extraServers(loaded, { servers: plugin, names: [] }).map((s) => s.serverName), ['ok']);
  assert.equal(loaded.warns.length, 2);
});

test('a managed deniedMcpServers that is not a list fails closed: every server is off', async () => {
  const fx = fixture();
  write(join(fx.managedDir, 'managed-settings.json'), { deniedMcpServers: { serverName: 'x' } });
  write(join(fx.userDir, '.claude.json'), { mcpServers: { mine: stdio('m') } });
  const result = await load(fx);
  assert.deepEqual(names(result), []);
  assert.equal(result.exclusive, true);
  assert.match(result.warns.join('\n'), /Managed policy is malformed/);
});

test('a managed policy entry that is malformed fails closed too', async () => {
  const fx = fixture();
  write(join(fx.managedDir, 'managed-settings.json'), { deniedMcpServers: [null] });
  write(join(fx.userDir, '.claude.json'), { mcpServers: { mine: stdio('m') } });
  assert.deepEqual(names(await load(fx)), []);
});

test('a disabledMcpjsonServers that is not a list is reported, not ignored', async () => {
  const fx = fixture();
  write(join(fx.project, '.mcp.json'), { mcpServers: { keep: stdio('k') } });
  write(join(fx.project, '.claude', 'settings.local.json'), { disabledMcpjsonServers: 'keep' });
  const result = await load(fx);
  assert.deepEqual(names(result), ['keep']);
  assert.match(result.warns.join('\n'), /disabledMcpjsonServers must be a list/);
});

test('a mcpServers that is not an object in .claude.json is reported, not ignored', async () => {
  const fx = fixture();
  write(join(fx.userDir, '.claude.json'), { mcpServers: ['mine'] });
  const result = await load(fx);
  assert.deepEqual(names(result), []);
  assert.match(result.warns.join('\n'), /\.claude\.json mcpServers must be an object/);
});

test('a managed-mcp.json that takes exclusive control says so, and what it turns off', async () => {
  const fx = fixture();
  write(join(fx.managedDir, 'managed-mcp.json'), { mcpServers: { corp: stdio('c') } });
  const result = await load(fx);
  assert.deepEqual(names(result), ['corp']);
  assert.match(result.warns.join('\n'), /takes exclusive control/);
});

test('a headersHelper that is not a string skips the server, instead of mounting it unauthenticated', async () => {
  const fx = fixture();
  write(join(fx.project, '.mcp.json'), { mcpServers: { api: { type: 'http', url: 'https://a.example/mcp', headersHelper: 123 } } });
  const result = await load(fx);
  assert.deepEqual(names(result), []);
  assert.match(result.warns.join('\n'), /headersHelper must be a non-empty string/);
});

test('a plugin deny rule matches the name the user wrote, not the sanitized one', () => {
  const warns = [];
  const policy = { allowed: undefined, denied: [{ serverName: 'corp.tool' }] };
  const kept = applyPolicy([{ serverName: 'corp_tool', url: 'https://p.example/mcp' }], policy, warns, ['corp.tool']);
  assert.deepEqual(kept, []);
  assert.match(warns.join('\n'), /corp\.tool: denied by policy, skipped/);
});

test('an unset variable in a policy entry is reported, and the entry keeps the literal text', () => {
  const policy = buildPolicy({ userSettings: { value: { deniedMcpServers: [{ serverUrl: 'https://${DCC_NOPE_X}/*' }] } } }, {});
  assert.match(policy.warns.join('\n'), /\$\{DCC_NOPE_X\} is not set/);
  assert.deepEqual(policy.denied, [{ serverUrl: 'https://${DCC_NOPE_X}/*' }]);
});

test('a host written with non-ASCII letters matches its ASCII form, as URL() writes it', () => {
  assert.equal(urlMatches('https://bücher.example/*', 'https://xn--bcher-kva.example/x'), true);
});

test('a deny pattern with no port covers the default port only, as Claude Code documents', () => {
  assert.equal(urlMatches('https://evil.example', 'https://evil.example:8443/x'), false);
  assert.equal(urlMatches('https://evil.example', 'https://evil.example/x'), true);
});

test('two plugin servers that sanitize to one name: the denied one is skipped, and the other keeps its own name', () => {
  const warns = [];
  const policy = { allowed: undefined, denied: [{ serverName: 'a.b' }] };
  const kept = applyPolicy(
    [{ serverName: 'a_b', url: 'https://one.example/mcp' }, { serverName: 'a_b', url: 'https://two.example/mcp' }],
    policy, warns, ['a.b', 'a_b'],
  );
  assert.deepEqual(kept.map((s) => s.url), ['https://two.example/mcp']);
  assert.match(warns.join('\n'), /a\.b: denied by policy, skipped/);
});

test('a managed deny host that does not parse makes the managed policy fail closed', () => {
  const docs = { managedSettings: { value: { deniedMcpServers: [{ serverUrl: 'https://exa mple.com/*' }] } } };
  const policy = buildPolicy(docs, {});
  assert.equal(policy.failClosed, true);
  assert.match(policy.warns.join('\n'), /host that is not valid/);
});

test('a managed deny that names an unset variable makes the managed policy fail closed', () => {
  const docs = { managedSettings: { value: { deniedMcpServers: [{ serverUrl: 'https://${DCC_UNSET_HOST}/*' }] } } };
  const policy = buildPolicy(docs, {});
  assert.equal(policy.failClosed, true);
  assert.match(policy.warns.join('\n'), /\$\{DCC_UNSET_HOST\} is not set/);
});

test('an unset variable in a user deny is reported, and does not fail the managed policy closed', () => {
  const docs = { userSettings: { value: { deniedMcpServers: [{ serverUrl: 'https://${DCC_UNSET_HOST}/*' }] } } };
  const policy = buildPolicy(docs, {});
  assert.equal(policy.failClosed, false);
  assert.match(policy.warns.join('\n'), /user settings deniedMcpServers: \$\{DCC_UNSET_HOST\}/);
});

test('a disable list element that is not a server name is reported with its position', async () => {
  const fx = fixture();
  write(join(fx.project, '.mcp.json'), { mcpServers: { keep: stdio('k') } });
  write(join(fx.project, '.claude', 'settings.local.json'), { disabledMcpjsonServers: [{ name: 'keep' }] });
  const result = await load(fx);
  assert.deepEqual(names(result), ['keep']);
  assert.match(result.warns.join('\n'), /disabledMcpjsonServers\[0\] must be a server name/);
});

test('a plugin manifest with an inline mcpServers object mounts its servers, with the plugin root substituted', () => {
  const result = translatePluginMcp({ mcpServers: { tool: { type: 'stdio', command: '${CLAUDE_PLUGIN_ROOT}/bin/run' } } }, '/opt/plug');
  assert.equal(result.servers.length, 1);
  assert.equal(result.servers[0].command, '/opt/plug/bin/run');
});

test('a plugin mcpServers that is neither a path nor an object is reported, not ignored', () => {
  const result = translatePluginMcp({ mcpServers: 42 }, '/opt/plug');
  assert.deepEqual(result.servers, []);
  assert.match(result.warns.join('\n'), /must be a path or an object/);
});

test('a managed-mcp.json that is a symlink to a missing file fails closed, and says so', async () => {
  const fx = fixture();
  symlinkSync(join(fx.managedDir, 'no-such-file.json'), join(fx.managedDir, 'managed-mcp.json'));
  write(join(fx.userDir, '.claude.json'), { mcpServers: { mine: stdio('m') } });
  const result = await load(fx);
  assert.deepEqual(names(result), []);
  assert.match(result.warns.join('\n'), /symbolic link to a missing file/);
});

test('a percent escape of an unreserved character matches the plain character, both ways', () => {
  assert.equal(urlMatches('https://evil.example/mcp', 'https://evil.example/%6Dcp'), true);
  assert.equal(urlMatches('https://evil.example/%6Dcp', 'https://evil.example/mcp'), true);
  assert.equal(urlMatches('https://evil.example/mcp', 'https://evil.example/mcp2'), false);
});

test('a projects value or project entry that is not an object is reported', async () => {
  const fx = fixture();
  write(join(fx.userDir, '.claude.json'), { projects: { [fx.project]: 'oops' }, mcpServers: { mine: stdio('m') } });
  const result = await load(fx);
  assert.deepEqual(names(result), ['mine']);
  assert.match(result.warns.join('\n'), /projects\[.*\] must be an object/);
});

test('a field that the transport never reads is reported as ignored', async () => {
  const fx = fixture();
  write(join(fx.project, '.mcp.json'), { mcpServers: { api: { type: 'http', url: 'https://a.example/mcp', args: ['x'] } } });
  const result = await load(fx);
  assert.deepEqual(names(result), ['api']);
  assert.match(result.warns.join('\n'), /api: args is ignored for this transport/);
});

test('a plugin root .mcp.json loads, and a later declared server with the same name replaces it', () => {
  const plugin = join(tempDir('dcc-plug-'), 'plug');
  mkdirSync(plugin, { recursive: true });
  writeFileSync(join(plugin, '.mcp.json'), JSON.stringify({ mcpServers: { a: { command: 'root-a' }, b: { command: 'root-b' } } }));
  const result = translatePluginMcp({ mcpServers: { b: { command: 'declared-b' } } }, plugin);
  const byName = Object.fromEntries(result.servers.map((s) => [s.serverName, s.command]));
  assert.deepEqual(byName, { a: 'root-a', b: 'declared-b' });
});

test('a plugin mcpServers bundle or URL is reported as not supported', () => {
  const result = translatePluginMcp({ mcpServers: ['./x.mcpb', 'https://e.example/s.dxt'] }, '/opt/plug');
  assert.deepEqual(result.servers, []);
  assert.match(result.warns.join('\n'), /bundles and URLs are not supported/);
});

test('a plugin path with $\' in it is substituted literally, not as a replacement pattern', () => {
  const plugin = join(tempDir('dcc-plug-'), "p$'x");
  mkdirSync(plugin, { recursive: true });
  const result = translatePluginMcp({ mcpServers: { tool: { command: '${CLAUDE_PLUGIN_ROOT}/bin/run' } } }, plugin);
  assert.equal(result.servers[0].command, `${plugin}/bin/run`);
});
