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
import { credentialNames, expandVars, redactValues, scrubbedEnv } from './mcp-vars.js';
import { buildPolicy, policyVerdict } from './mcp-policy.js';
import { readSourceDocs, selectEntries } from './mcp-sources.js';

const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1000;
// Node fires a timer with a larger delay after 1 ms.
const MAX_TIMEOUT_MS = 2_147_483_647;
// Claude Code gives a headersHelper 10 seconds, and so does this loader.
const HEADERS_HELPER_TIMEOUT_MS = 10_000;
const execAsync = promisify(exec);

function isScalar(value) {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isScalarDict(value) {
  return isObject(value) && Object.values(value).every(isScalar);
}

function mapValues(object, fn) {
  return Object.fromEntries(Object.entries(object).map(([k, v]) => [k, fn(v)]));
}

// Turn a scalar dict into strings. Callers check the shape first.
function scalarDict(value) {
  return value === undefined ? {} : mapValues(value, String);
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
  if (typeof entry.timeout === 'number' && entry.timeout >= MIN_TIMEOUT_MS) {
    if (entry.timeout <= MAX_TIMEOUT_MS) return entry.timeout;
    warns.push(`${name}: timeout is above ${MAX_TIMEOUT_MS} ms, ${MAX_TIMEOUT_MS} ms used`);
    return MAX_TIMEOUT_MS;
  }
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
    args: (entry.args ?? []).map(expand),
    env,
    cwd: entry.cwd === undefined ? '' : expand(entry.cwd),
  };
  return { server };
}

function httpConfig(name, entry, base, expand) {
  if (typeof entry.url !== 'string' || entry.url.length === 0) {
    return { warn: `${name}: http entry has no url, skipped` };
  }
  // fieldProblem has already checked that a helper is a non-empty string.
  const helper = entry.headersHelper;
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
    const why = opts.withheld?.has(variable)
      ? 'is a credential variable that a project .mcp.json may not read, and mcpTrustProjectConfig is false'
      : 'is not set and has no default';
    warns.push(`${name}: \${${variable}} ${why}, the literal text is kept`);
  });
  const base = {
    serverName,
    toolCallTimeoutMs: timeoutOf(name, entry, warns),
    failOnStartupError: opts.failOnStartupError ?? false,
  };
  noteUnsupported(name, entry, warns);
  // A field the chosen transport never reads would be dropped without a word.
  const unread = transport === 'stdio' ? ['url', 'headers', 'headersHelper'] : ['command', 'args', 'env', 'cwd'];
  for (const field of unread) {
    if (entry[field] !== undefined) warns.push(`${name}: ${field} is ignored for this transport`);
  }
  const built = transport === 'stdio'
    ? stdioConfig(name, entry, base, expand, opts.projectDir)
    : httpConfig(name, entry, base, expand);
  if (built.warn !== undefined) return { warns: [...warns, built.warn] };
  const usesVars = JSON.stringify({ ...entry, env: undefined }).includes('${');
  return { server: built.server, helper: built.helper, usesVars, warns };
}

// Translate server entries, as [name, entry] pairs, into dsh-mcp-client configs. Malformed
// entries are skipped and reported. A plugin entry with a headersHelper is skipped, because
// a helper that never runs would mount a server that cannot authenticate. `names[i]` is the
// name the user wrote for `servers[i]`. The sanitized name can collide, so the position is
// the key, not the name. `vars` is the environment that ${VAR} reads.
export function translateServerEntries(pairs, { failOnStartupError = false, vars } = {}) {
  const out = [];
  const warns = [];
  const names = [];
  for (const [name, entry] of pairs) {
    if (!isObject(entry)) {
      warns.push(`${name}: malformed entry, skipped`);
      continue;
    }
    const translated = translateEntry(name, entry, { failOnStartupError, vars });
    warns.push(...translated.warns);
    if (translated.server === undefined) continue;
    if (translated.helper !== undefined) {
      warns.push(`${name}: headersHelper is not run for plugin servers, skipped`);
      continue;
    }
    out.push(translated.server);
    names.push(name);
  }
  return { servers: out, warns, names };
}

// Translate the body of a .mcp.json file into dsh-mcp-client configs.
export function translateMcpServers(rawJson, options = {}) {
  let parsed;
  try { parsed = JSON.parse(rawJson); }
  catch (error) {
    return { servers: [], warns: [`invalid-json: ${error.message}`], names: [] };
  }
  if (!isObject(parsed)) return { servers: [], warns: ['invalid-json: root must be an object'], names: [] };
  if (!isObject(parsed.mcpServers)) return { servers: [], warns: ['mcpServers: missing or not an object'], names: [] };
  return translateServerEntries(Object.entries(parsed.mcpServers), options);
}

// The environment of a helper. A helper from a project file is a command the user did not
// write, so it gets no credential variables, and the server URL hides their values.
function helperEnv({ name, url, scrub }) {
  const base = scrub ? scrubbedEnv(process.env) : { env: process.env, removed: [] };
  return {
    ...base.env,
    CLAUDE_CODE_MCP_SERVER_NAME: name,
    CLAUDE_CODE_MCP_SERVER_URL: redactValues(url, base.removed),
  };
}

// Run a headersHelper and parse its JSON object of header values. Errors are
// returned, not thrown, so the caller can warn and skip the one server.
async function runHeadersHelper(command, context) {
  let stdout;
  try {
    ({ stdout } = await execAsync(command, {
      timeout: HEADERS_HELPER_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: helperEnv(context),
    }));
  } catch (error) {
    // The message of exec holds the command line, so the text is built from the parts.
    const stderr = String(error?.stderr ?? '').trim().split('\n')[0].slice(0, 200);
    const cause = error?.killed ? `timed out after ${HEADERS_HELPER_TIMEOUT_MS} ms` : `exit ${error?.code ?? 'unknown'}`;
    return { error: `command failed (${cause})${stderr === '' ? '' : `: ${stderr}`}` };
  }
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { return { error: 'output is not JSON' }; }
  if (!isObject(parsed)) return { error: 'output is not a JSON object' };
  if (!isScalarDict(parsed)) return { error: 'output has a value that is not a string, number or boolean' };
  return { headers: scalarDict(parsed) };
}

// What the allowlist check sees. The organization's own servers skip the allowlist.
function policyView(entry, translated) {
  const skipAllowlist = entry.scope === 'managed-settings'
    || (entry.scope === 'managed-file' && translated.usesVars !== true);
  return { ...translated.server, label: entry.name, skipAllowlist };
}

// The managed settings entry contract: a fixed https remote server. It has no command,
// arguments, environment, helper or variable. managed-mcp.json has its own contract.
function managedSettingsProblem(raw) {
  const fields = ['command', 'args', 'env', 'headersHelper'].filter((field) => raw[field] !== undefined);
  if (fields.length > 0) return `${fields.join(', ')} not allowed`;
  if (JSON.stringify(raw).includes('${')) return 'variable references not allowed';
  if (typeof raw.url !== 'string' || !/^https:\/\//i.test(raw.url)) return 'url must start with https://';
  return undefined;
}

// Apply the headersHelper of one entry. Returns the server to mount, or undefined to skip it.
async function withHelper(entry, view, translated, state) {
  const name = entry.name;
  // A helper from a project .mcp.json is a command that the user did not write.
  if (entry.scope === 'project' && state.options.trustProject !== true) {
    state.out.warns.push(
      `${name}: headersHelper of a project .mcp.json is not run, because mcpTrustProjectConfig is false. `
      + 'The server mounts with its static headers.',
    );
    return translated.server;
  }
  // An allowlist cannot see the helper command, so a helper could run any command.
  // Under an allowlist, only the organization's own servers may use one.
  if (state.policy.allowed !== undefined && view.skipAllowlist !== true) {
    state.out.warns.push(`${name}: headersHelper is not run under an allowlist, skipped`);
    return undefined;
  }
  const server = translated.server;
  const result = await runHeadersHelper(translated.helper, { name, url: server.url, scrub: entry.scope === 'project' });
  if (result.error !== undefined) {
    state.out.warns.push(`${name}: headersHelper ${result.error}, server skipped`);
    return undefined;
  }
  // Dynamic headers override static ones with the same name.
  return { ...server, headers: { ...server.headers, ...result.headers } };
}

// A project .mcp.json is not the user's own file. Unless the user trusts it, ${VAR} in it does
// not read credential variables, so a repository cannot send them to a server it names.
function optionsFor(entry, state) {
  if (entry.scope !== 'project' || state.options.trustProject === true) return state.options;
  const { vars } = state.options;
  return { ...state.options, vars: scrubbedEnv(vars).env, withheld: credentialNames(vars) };
}

// Translate, check the policy, run the helper, and collect one server. `state`
// holds the translation options, the policy and the output lists.
async function loadOne(entry, state) {
  if (!isObject(entry.raw)) {
    state.out.warns.push(`${entry.name}: malformed entry, skipped`);
    return;
  }
  const invalid = entry.scope === 'managed-settings' ? managedSettingsProblem(entry.raw) : undefined;
  if (invalid !== undefined) {
    state.out.warns.push(`${entry.name}: managedMcpServers entry is invalid (${invalid}), skipped`);
    return;
  }
  const translated = translateEntry(entry.name, entry.raw, optionsFor(entry, state));
  state.out.warns.push(...translated.warns);
  if (translated.server === undefined) return;
  const view = policyView(entry, translated);
  const reason = policyVerdict(view, state.policy);
  if (reason !== undefined) {
    state.out.warns.push(`${entry.name}: ${reason}, skipped`);
    return;
  }
  const server = translated.helper === undefined
    ? translated.server
    : await withHelper(entry, view, translated, state);
  if (server === undefined) return;
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
    options: {
      vars,
      failOnStartupError: config.mcpFailOnStartupError ?? false,
      projectDir,
      trustProject: config.mcpTrustProjectConfig === true,
    },
    policy,
    out: { servers: [], warns: [...selected.warns, ...policy.warns] },
  };
  for (const entry of selected.entries) {
    try {
      await loadOne(entry, state);
    } catch (error) {
      state.out.warns.push(`${entry.name}: unexpected error, skipped (${error?.message ?? error})`);
    }
  }
  return { servers: state.out.servers, exclusive: selected.exclusive, warns: state.out.warns, policy };
}

// Check plugin servers against the policy, by the name the user wrote (`names[i]`
// for `servers[i]`), and by URL, command and arguments.
export function applyPolicy(servers, policy, warns, names = []) {
  return servers.filter((server, index) => {
    const label = names[index] ?? server.serverName;
    const view = { label, url: server.url, command: server.command, args: server.args };
    const reason = policyVerdict(view, policy);
    if (reason === undefined) return true;
    warns.push(`${label}: ${reason}, skipped`);
    return false;
  });
}

// The plugin servers that may mount next to the loaded ones. They must pass the
// policy, and their URL must not already be in use by a loaded server. `plugin`
// is { servers, names }, as translateMcpServers gives it.
export function extraServers(loaded, plugin) {
  const allowed = applyPolicy(plugin.servers, loaded.policy, loaded.warns, plugin.names);
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
    console.warn(
      `dsh-claude-compat: cannot import @deepseek-ai/dsh-mcp-client (${error?.code ?? error?.message ?? error}), `
      + `so ${servers.length} MCP server(s) are not mounted`,
    );
    return;
  }
  const mcpClient = mcpClientModule.default ?? mcpClientModule;
  const mounted = new Set();
  for (const server of servers) {
    if (mounted.has(server.serverName)) {
      console.warn(`dsh-claude-compat: MCP server "${server.serverName}" has the same name as an earlier server after sanitizing, so it is skipped`);
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
