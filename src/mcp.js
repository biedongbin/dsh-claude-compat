// dsh-claude-compat: MCP servers from Claude Code's config files. The loader
// reads the sources in precedence order (see src/mcp-sources.js), applies the
// allow and deny policy (src/mcp-policy.js), and translates each entry into a
// dsh-mcp-client plugin config. Each server mounts as one plugin instance:
// stdio for `command` entries, streamable-http for `type: http` entries.
//
// Failure handling is deliberately non-fatal: a malformed file, an unsupported
// entry or an absent dsh-mcp-client package logs a warning and skips, never
// crashing the harness. The one exception is a broken managed-mcp.json, which
// keeps every other server off (see src/mcp-sources.js).

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { findProjectRootSync } from './lib.js';
import { expandVars } from './mcp-vars.js';
import { buildPolicy, policyVerdict } from './mcp-policy.js';
import { readSourceDocs, selectEntries } from './mcp-sources.js';

const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1000;
// Claude Code gives a headersHelper 10 seconds, and so does this loader.
const HEADERS_HELPER_TIMEOUT_MS = 10_000;
const execAsync = promisify(exec);

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringDict(v) {
  if (!isObject(v)) return {};
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'string') out[k] = val;
    else if (typeof val === 'number' || typeof val === 'boolean') out[k] = String(val);
  }
  return out;
}

function stringList(v) {
  return Array.isArray(v) ? v.filter((a) => typeof a === 'string') : [];
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
  if (entry.type === 'sse' || entry.type === 'ws') return `${name}: type '${entry.type}' is not supported, skipped`;
  return `${name}: type '${entry.type}' is not supported here, skipped`;
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
  const env = { ...projectEnv, ...mapValues(stringDict(entry.env), expand) };
  const server = {
    ...base,
    transport: 'stdio',
    command: expand(entry.command),
    args: stringList(entry.args).map(expand),
    env,
    cwd: typeof entry.cwd === 'string' ? entry.cwd : '',
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
    headers: mapValues(stringDict(entry.headers), expand),
  };
  return { server, helper };
}

// Translate one Claude Code server entry. Returns { server, helper, usesVars,
// warns }. `server` is undefined when the entry is skipped, and `helper` is the
// headersHelper command to run before mounting. `usesVars` is true when a value
// outside `env` uses ${VAR}, which the allowlist check depends on.
export function translateEntry(name, entry, opts = {}) {
  const warns = [];
  const serverName = name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32);
  if (serverName.length === 0) return { warns: [`${name}: empty server name, skipped`] };
  const transport = transportOf(entry);
  if (transport === undefined) return { warns: [unsupportedReason(name, entry)] };
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

// Pure translation of a plugin's .mcp.json body into dsh-mcp-client configs,
// keyed by server name. Malformed entries are skipped and reported.
export function translateMcpServers(rawJson, { failOnStartupError = false, vars, projectDir } = {}) {
  let parsed;
  try { parsed = JSON.parse(rawJson); }
  catch {
    return { servers: [], warns: [`invalid-json: ${String(rawJson).slice(0, 100)}`] };
  }
  if (!isObject(parsed)) return { servers: [], warns: ['invalid-json: root must be an object'] };
  if (!isObject(parsed.mcpServers)) return { servers: [], warns: ['mcpServers: missing or not an object'] };
  const out = [];
  const warns = [];
  for (const [name, entry] of Object.entries(parsed.mcpServers)) {
    if (!isObject(entry)) {
      warns.push(`${name}: malformed entry, skipped`);
      continue;
    }
    const translated = translateEntry(name, entry, { failOnStartupError, vars, projectDir });
    warns.push(...translated.warns);
    if (translated.server === undefined) continue;
    if (translated.helper !== undefined) warns.push(`${name}: headersHelper is not run for plugin servers`);
    out.push(translated.server);
  }
  return { servers: out, warns };
}

// Run a headersHelper and parse its JSON object of header values. Errors are
// returned, not thrown, so the caller can warn and skip the one server.
export async function runHeadersHelper(command, { name, url }) {
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
  return { headers: stringDict(parsed) };
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
  return {
    label: entry.name,
    url: translated.server.url,
    command: translated.server.command,
    args: translated.server.args,
    skipAllowlist,
  };
}

async function loadOne(entry, { vars, failOnStartupError, projectDir, policy, out }) {
  const translated = translateEntry(entry.name, entry.raw, { vars, failOnStartupError, projectDir });
  out.warns.push(...translated.warns);
  if (translated.server === undefined) return;
  const reason = policyVerdict(policyView(entry, translated), policy);
  if (reason !== undefined) {
    out.warns.push(`${entry.name}: ${reason}, skipped`);
    return;
  }
  let server = translated.server;
  if (translated.helper !== undefined) {
    const dynamic = await withDynamicHeaders(entry.name, server, translated.helper);
    if (dynamic.warn !== undefined) {
      out.warns.push(dynamic.warn);
      return;
    }
    server = dynamic.server;
  }
  out.servers.push(server);
}

// Load the MCP servers that Claude Code configures for this user and project.
// `cwd` is the launch folder, and `managedDir` can be replaced for tests.
export async function loadMcpServers(config, { cwd = process.cwd(), managedDir } = {}) {
  const projectRoot = findProjectRootSync(cwd, config.projectRootMarkers);
  const projectDir = projectRoot ?? cwd;
  const docs = await readSourceDocs({ config, cwd, projectRoot, managedDir });
  const selected = selectEntries(docs);
  const vars = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
  const policy = buildPolicy(docs, vars);
  const failOnStartupError = config.mcpFailOnStartupError ?? false;
  const out = { servers: [], warns: [...selected.warns] };
  for (const entry of selected.entries) {
    await loadOne(entry, { vars, failOnStartupError, projectDir, policy, out });
  }
  return { servers: out.servers, exclusive: selected.exclusive, warns: out.warns };
}

// Drop plugin servers whose URL a higher-precedence server already uses.
export function withoutDuplicateUrls(servers, pluginServers) {
  const urls = new Set(servers.map((s) => s.url).filter((u) => u !== undefined));
  return pluginServers.filter((s) => s.url === undefined || !urls.has(s.url));
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
    // ctx.plugin returns a Fiber (PromiseLike) in real cordis; guard for
    // non-promise returns in tests/embeddings.
    const fiber = ctx.plugin(mcpClient, server);
    if (fiber && typeof fiber.catch === 'function') {
      fiber.catch((error) => {
        console.warn(`dsh-claude-compat: server "${server.serverName}" failed to mount: ${error?.message ?? error}`);
      });
    }
  }
}
