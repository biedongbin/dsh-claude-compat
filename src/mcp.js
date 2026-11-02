// dsh-claude-compat: MCP servers from Claude Code's config files. The loader
// reads the sources in precedence order (see src/mcp-sources.js), applies the
// allow and deny policy (src/mcp-policy.js), and translates each entry into a
// dsh-mcp-client plugin config. Each server mounts as one plugin instance:
// stdio for `command` entries, streamable-http for `type: http` entries.
//
// A skipped entry always produces a warning that names it and the reason. A
// broken managed file fails closed (see src/mcp-sources.js). Any other failure
// logs a warning and skips the one server, and never crashes the harness.

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { findProjectRootSync, isObject } from './lib.js';
import { expandVars } from './mcp-vars.js';
import { buildPolicy, policyVerdict } from './mcp-policy.js';
import { readSourceDocs, selectEntries } from './mcp-sources.js';

const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1000;
// Claude Code gives a headersHelper 10 seconds, and so does this loader.
const HEADERS_HELPER_TIMEOUT_MS = 10_000;
const execAsync = promisify(exec);

function isScalar(value) {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isScalarDict(value) {
  return isObject(value) && Object.values(value).every(isScalar);
}

// Turn a scalar dict into strings. Callers check the shape first.
function scalarDict(value) {
  if (value === undefined) return {};
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)]));
}

function stringList(value) {
  return value ?? [];
}

function mapValues(object, fn) {
  return Object.fromEntries(Object.entries(object).map(([k, v]) => [k, fn(v)]));
}

// The transport a Claude Code entry asks for, or undefined when DSH cannot run it.
// An entry with a `url` and no `type` is skipped, as Claude Code skips it.
function transportOf(entry) {
  if (entry.type === undefined) return typeof entry.command === 'string' ? 'stdio' : undefined;
  if (entry.type === 'stdio') return 'stdio';
  if (entry.type === 'http' || entry.type === 'streamable-http') return 'streamable-http';
  return undefined;
}

function unsupportedReason(name, entry) {
  if (entry.type === undefined && typeof entry.url === 'string') {
    return `${name}: a url with no "type" is skipped, add "type": "http"`;
  }
  if (entry.type === undefined) return `${name}: neither command nor url, skipped`;
  return `${name}: type '${entry.type}' is not supported, skipped`;
}

// A field of the wrong type skips the entry. A wrong argument list or
// environment would start the server with the wrong input.
function fieldProblem(name, entry) {
  if (entry.args !== undefined && !(Array.isArray(entry.args) && entry.args.every((a) => typeof a === 'string'))) {
    return `${name}: args must be a list of strings, skipped`;
  }
  if (entry.cwd !== undefined && typeof entry.cwd !== 'string') return `${name}: cwd must be a string, skipped`;
  for (const field of ['env', 'headers']) {
    if (entry[field] !== undefined && !isScalarDict(entry[field])) {
      return `${name}: ${field} must map names to strings, numbers or booleans, skipped`;
    }
  }
  // A helper that is present but not a command would be dropped, and the server would mount unauthenticated.
  if (entry.headersHelper !== undefined && (typeof entry.headersHelper !== 'string' || entry.headersHelper.length === 0)) {
    return `${name}: headersHelper must be a non-empty string, skipped`;
  }
  return undefined;
}

// `timeout` is milliseconds. A value below one second is ignored, as in Claude Code.
function timeoutOf(name, entry, warns) {
  if (entry.timeout === undefined) return DEFAULT_TOOL_CALL_TIMEOUT_MS;
  if (typeof entry.timeout === 'number' && entry.timeout >= MIN_TIMEOUT_MS) return entry.timeout;
  warns.push(`${name}: timeout must be at least ${MIN_TIMEOUT_MS} ms, default used`);
  return DEFAULT_TOOL_CALL_TIMEOUT_MS;
}

function noteUnsupported(name, entry, warns) {
  if (entry.oauth !== undefined) warns.push(`${name}: oauth is not supported, the server loads without OAuth`);
  if (entry.alwaysLoad !== undefined) warns.push(`${name}: alwaysLoad is not supported and is ignored`);
}

function stdioConfig(name, entry, base, expand, projectDir) {
  if (typeof entry.command !== 'string' || entry.command.length === 0) {
    return { warn: `${name}: stdio entry has no command, skipped` };
  }
  const projectEnv = projectDir === undefined ? {} : { CLAUDE_PROJECT_DIR: projectDir };
  const env = { ...projectEnv, ...mapValues(scalarDict(entry.env), expand) };
  const server = {
    ...base,
    transport: 'stdio',
    command: expand(entry.command),
    args: stringList(entry.args).map(expand),
    env,
    cwd: entry.cwd ?? '',
  };
  return { server };
}

function httpConfig(name, entry, base, expand) {
  if (typeof entry.url !== 'string' || entry.url.length === 0) {
    return { warn: `${name}: http entry has no url, skipped` };
  }
  const helper = typeof entry.headersHelper === 'string' && entry.headersHelper.length > 0
    ? entry.headersHelper
    : undefined;
  const server = {
    ...base,
    transport: 'streamable-http',
    url: expand(entry.url),
    headers: mapValues(scalarDict(entry.headers), expand),
  };
  return { server, helper };
}

// Translate one Claude Code server entry. Returns { server, helper, usesVars,
// warns }. `server` is undefined when the entry is skipped, and `helper` is the
// headersHelper command to run before mounting. `usesVars` is true when a value
// outside `env` uses ${VAR}, which the allowlist check depends on.
function translateEntry(name, entry, opts = {}) {
  const warns = [];
  const serverName = name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32);
  if (serverName.length === 0) return { warns: [`${name}: empty server name, skipped`] };
  const transport = transportOf(entry);
  if (transport === undefined) return { warns: [unsupportedReason(name, entry)] };
  const problem = fieldProblem(name, entry);
  if (problem !== undefined) return { warns: [problem] };
  const vars = opts.vars ?? process.env;
  const expand = (value) => expandVars(value, vars, (variable) => {
    warns.push(`${name}: \${${variable}} is not set and has no default, the literal text is kept`);
  });
  const base = {
    serverName,
    toolCallTimeoutMs: timeoutOf(name, entry, warns),
    failOnStartupError: opts.failOnStartupError ?? false,
  };
  noteUnsupported(name, entry, warns);
  const built = transport === 'stdio'
    ? stdioConfig(name, entry, base, expand, opts.projectDir)
    : httpConfig(name, entry, base, expand);
  if (built.warn !== undefined) return { warns: [...warns, built.warn] };
  const usesVars = JSON.stringify({ ...entry, env: undefined }).includes('${');
  return { server: built.server, helper: built.helper, usesVars, warns };
}

// Translate a plugin's .mcp.json body into dsh-mcp-client configs, keyed by server
// name. Malformed entries are skipped and reported. A plugin entry with a
// headersHelper is skipped, because a helper that never runs would mount a server
// that cannot authenticate.
export function translateMcpServers(rawJson, { failOnStartupError = false } = {}) {
  let parsed;
  try { parsed = JSON.parse(rawJson); }
  catch {
    return { servers: [], warns: [`invalid-json: ${String(rawJson).slice(0, 100)}`], labels: {} };
  }
  if (!isObject(parsed)) return { servers: [], warns: ['invalid-json: root must be an object'], labels: {} };
  if (!isObject(parsed.mcpServers)) return { servers: [], warns: ['mcpServers: missing or not an object'], labels: {} };
  const out = [];
  const warns = [];
  // Plugin servers are named after their sanitized name, so the policy needs the
  // name the user wrote. Map the one to the other here.
  const labels = {};
  for (const [name, entry] of Object.entries(parsed.mcpServers)) {
    if (!isObject(entry)) {
      warns.push(`${name}: malformed entry, skipped`);
      continue;
    }
    const translated = translateEntry(name, entry, { failOnStartupError });
    warns.push(...translated.warns);
    if (translated.server === undefined) continue;
    if (translated.helper !== undefined) {
      warns.push(`${name}: headersHelper is not run for plugin servers, skipped`);
      continue;
    }
    out.push(translated.server);
    labels[translated.server.serverName] = name;
  }
  return { servers: out, warns, labels };
}

// Run a headersHelper and parse its JSON object of header values. Errors are
// returned, not thrown, so the caller can warn and skip the one server.
async function runHeadersHelper(command, { name, url }) {
  let stdout;
  try {
    ({ stdout } = await execAsync(command, {
      timeout: HEADERS_HELPER_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, CLAUDE_CODE_MCP_SERVER_NAME: name, CLAUDE_CODE_MCP_SERVER_URL: url },
    }));
  } catch (error) {
    return { error: `command failed: ${error?.message ?? error}` };
  }
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { return { error: 'output is not JSON' }; }
  if (!isObject(parsed)) return { error: 'output is not a JSON object' };
  if (!isScalarDict(parsed)) return { error: 'output has a value that is not a string, number or boolean' };
  return { headers: scalarDict(parsed) };
}

// Apply the headersHelper output. Dynamic headers override static ones with the same name.
async function withDynamicHeaders(name, server, helper) {
  const result = await runHeadersHelper(helper, { name, url: server.url });
  if (result.error !== undefined) return { warn: `${name}: headersHelper ${result.error}, server skipped` };
  return { server: { ...server, headers: { ...server.headers, ...result.headers } } };
}

// What the allowlist check sees. The organization's own servers skip the allowlist.
function policyView(entry, translated) {
  const skipAllowlist = entry.scope === 'managed-settings'
    || (entry.scope === 'managed-file' && translated.usesVars !== true);
  return { ...translated.server, label: entry.name, skipAllowlist };
}

// Translate, check the policy, run the helper, and collect one server. `state`
// holds the translation options, the policy and the output lists.
async function loadOne(entry, state) {
  const translated = translateEntry(entry.name, entry.raw, state.options);
  state.out.warns.push(...translated.warns);
  if (translated.server === undefined) return;
  const view = policyView(entry, translated);
  const reason = policyVerdict(view, state.policy);
  if (reason !== undefined) {
    state.out.warns.push(`${entry.name}: ${reason}, skipped`);
    return;
  }
  let server = translated.server;
  if (translated.helper !== undefined) {
    // An allowlist cannot see the helper command, so a helper could run any command.
    // Under an allowlist, only the organization's own servers may use one.
    if (state.policy.allowed !== undefined && view.skipAllowlist !== true) {
      state.out.warns.push(`${entry.name}: headersHelper is not run under an allowlist, skipped`);
      return;
    }
    const dynamic = await withDynamicHeaders(entry.name, server, translated.helper);
    if (dynamic.warn !== undefined) {
      state.out.warns.push(dynamic.warn);
      return;
    }
    server = dynamic.server;
  }
  state.out.servers.push(server);
}

// Load the MCP servers that Claude Code configures for this user and project.
// `cwd` is the launch folder, and `managedDir` can be replaced for tests. The
// result holds the policy, so plugin servers can be checked against it too.
export async function loadMcpServers(config, { cwd = process.cwd(), managedDir } = {}) {
  const projectRoot = findProjectRootSync(cwd, config.projectRootMarkers);
  const projectDir = projectRoot ?? cwd;
  const docs = await readSourceDocs({ config, cwd, projectRoot, managedDir });
  const selected = selectEntries(docs);
  const vars = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
  const policy = buildPolicy(docs, vars);
  if (policy.failClosed) {
    const warns = [...selected.warns, ...policy.warns, 'Managed policy is malformed, so every MCP server is off.'];
    return { servers: [], exclusive: true, warns, policy };
  }
  const state = {
    options: { vars, failOnStartupError: config.mcpFailOnStartupError ?? false, projectDir },
    policy,
    out: { servers: [], warns: [...selected.warns, ...policy.warns] },
  };
  for (const entry of selected.entries) await loadOne(entry, state);
  return { servers: state.out.servers, exclusive: selected.exclusive, warns: state.out.warns, policy };
}

// Check plugin servers against the policy, by the name the user wrote (`labels`
// maps each sanitized name to it), and by URL, command and arguments.
export function applyPolicy(servers, policy, warns, labels = {}) {
  return servers.filter((server) => {
    const label = Object.hasOwn(labels, server.serverName) ? labels[server.serverName] : server.serverName;
    const view = { label, url: server.url, command: server.command, args: server.args };
    const reason = policyVerdict(view, policy);
    if (reason === undefined) return true;
    warns.push(`${label}: ${reason}, skipped`);
    return false;
  });
}

// The plugin servers that may mount next to the loaded ones. They must pass the
// policy, and their URL must not already be in use by a loaded server. `plugin`
// is the result of translateMcpServers: { servers, labels }.
export function extraServers(loaded, plugin) {
  const allowed = applyPolicy(plugin.servers, loaded.policy, loaded.warns, plugin.labels);
  return withoutDuplicateUrls(loaded.servers, allowed, loaded.warns);
}

// Drop plugin servers whose URL a higher-precedence server already uses.
export function withoutDuplicateUrls(servers, pluginServers, warns) {
  const urls = new Set(servers.map((s) => s.url).filter((u) => u !== undefined));
  return pluginServers.filter((s) => {
    if (s.url === undefined || !urls.has(s.url)) return true;
    warns.push(`${s.serverName}: plugin server uses a URL that a higher source already mounts, skipped`);
    return false;
  });
}

// Mount pre-translated server configs (shared by the project and plugin MCP).
export async function mountMcpConfigs(ctx, servers) {
  if (servers.length === 0) return;
  let mcpClientModule;
  try {
    mcpClientModule = await import('@deepseek-ai/dsh-mcp-client');
  } catch (error) {
    console.warn('dsh-claude-compat: @deepseek-ai/dsh-mcp-client not installed', '(MCP disabled)', error?.message ?? error);
    return;
  }
  const mcpClient = mcpClientModule.default ?? mcpClientModule;
  const mounted = new Set();
  for (const server of servers) {
    if (mounted.has(server.serverName)) {
      console.warn(`dsh-claude-compat: duplicate serverName "${server.serverName}" skipped`);
      continue;
    }
    mounted.add(server.serverName);
    mountOne(ctx, mcpClient, server);
  }
}

// ctx.plugin can throw at once or reject later. Either way only this server is lost.
function mountOne(ctx, mcpClient, server) {
  let fiber;
  try {
    fiber = ctx.plugin(mcpClient, server);
  } catch (error) {
    console.warn(`dsh-claude-compat: server "${server.serverName}" failed to mount: ${error?.message ?? error}`);
    return;
  }
  // ctx.plugin returns a Fiber (PromiseLike) in real cordis; guard for
  // non-promise returns in tests/embeddings.
  if (fiber && typeof fiber.catch === 'function') {
    fiber.catch((error) => {
      console.warn(`dsh-claude-compat: server "${server.serverName}" failed to mount: ${error?.message ?? error}`);
    });
  }
}
