// Project MCP discovery for a multi-session Desktop. Connections and tool names
// belong to the Agent scope; source files and credentials are read again before
// prompt assembly so another project or a changed credential cannot reuse them.
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import { findProjectRootSync } from './lib.js';

const REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

async function readServers(filename, source, warn) {
  let text;
  try { text = await readFile(filename, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') warn(`cannot read MCP configuration ${filename}`); return {}; }
  try {
    const parsed = source === 'codex' ? parseToml(text) : source === 'agents' ? parseYaml(text) : JSON.parse(text);
    const servers = source === 'codex' ? parsed.mcp_servers : source === 'agents' ? parsed.servers : parsed.mcpServers;
    return object(servers) ? servers : {};
  } catch { warn(`cannot parse MCP configuration ${filename}`); return {}; }
}

async function expand(value, credential, missing) {
  if (typeof value !== 'string') return value;
  let result = '', position = 0;
  for (const match of value.matchAll(REF)) {
    result += value.slice(position, match.index);
    const resolved = await credential(match[1]);
    if (resolved === undefined && match[2] === undefined) missing.add(match[1]);
    result += resolved ?? match[2] ?? '';
    position = match.index + match[0].length;
  }
  return result + value.slice(position);
}

async function stringMap(value, credential, missing) {
  const result = {};
  for (const [name, item] of Object.entries(object(value) ? value : {})) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      result[name] = await expand(String(item), credential, missing);
    }
  }
  return result;
}

async function normalize(name, entry, source, cwd, credential, config, warn) {
  if (!object(entry) || entry.disabled === true || entry.enabled === false) return;
  const exclusions = (config.mcpExcludedServers ?? []).map(value => value.toLowerCase());
  if (exclusions.includes(name.toLowerCase()) || exclusions.includes(`${source}:${name}`.toLowerCase())) return;
  const serverName = name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32);
  if (serverName.length === 0) { warn('skipping MCP server with an empty name'); return; }
  const missing = new Set();
  const base = { serverName, toolCallTimeoutMs: 60000, failOnStartupError: config.mcpFailOnStartupError ?? false };
  const commandArray = Array.isArray(entry.command) ? entry.command : [entry.command, ...Array.isArray(entry.args) ? entry.args : []];
  if (typeof commandArray[0] === 'string') {
    const expanded = await Promise.all(commandArray.filter(value => typeof value === 'string').map(value => expand(value, credential, missing)));
    const env = await stringMap(entry.env, credential, missing);
    const directory = typeof entry.cwd === 'string' ? resolve(cwd, await expand(entry.cwd, credential, missing)) : cwd;
    for (const variable of Array.isArray(entry.env_vars) ? entry.env_vars : []) {
      if (typeof variable !== 'string') continue;
      const value = await credential(variable);
      if (value !== undefined) env[variable] = value;
    }
    if (missing.size > 0) { warn(`MCP ${name}: missing credential references ${[...missing].join(', ')}`); return; }
    return { ...base, transport: 'stdio', command: expanded[0], args: expanded.slice(1), env, cwd: directory };
  }
  if (typeof entry.url !== 'string') { warn(`MCP ${name}: no command or URL`); return; }
  const url = await expand(entry.url, credential, missing);
  const headers = await stringMap(entry.http_headers ?? entry.headers, credential, missing);
  for (const [header, variable] of Object.entries(object(entry.env_http_headers) ? entry.env_http_headers : {})) {
    if (typeof variable !== 'string') continue;
    const value = await credential(variable);
    if (value === undefined) missing.add(variable); else headers[header] = value;
  }
  if (typeof entry.bearer_token_env_var === 'string') {
    const token = await credential(entry.bearer_token_env_var);
    if (token === undefined) missing.add(entry.bearer_token_env_var); else headers.Authorization = `Bearer ${token}`;
  }
  if (missing.size > 0) { warn(`MCP ${name}: missing credential references ${[...missing].join(', ')}`); return; }
  try { const parsed = new URL(url); if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error(); }
  catch { warn(`MCP ${name}: invalid HTTP URL`); return; }
  return { ...base, transport: 'streamable-http', url, headers };
}

/** Highest-priority project sources override every user source; disabled entries remain tombstones. */
export async function discoverProjectMcp(cwd, config, options = {}) {
  const warn = options.warn ?? (message => console.warn(`dsh-claude-compat: ${message}`));
  const credential = options.credential ?? (async name => process.env[name]);
  const home = options.home ?? homedir();
  const root = findProjectRootSync(cwd, config.projectRootMarkers) ?? cwd;
  const sourceFiles = {
    dsh: [join(home, '.dsh', 'mcp.json'), join(root, '.dsh', 'mcp.json')],
    claude: [join(home, '.claude.json'), join(root, '.mcp.json')],
    codex: [join(home, '.codex', 'config.toml'), join(root, '.codex', 'config.toml')],
    agents: [join(home, '.agents', 'mcp.yaml'), join(root, '.agents', 'mcp.yaml')],
  };
  const sources = config.mcpSources ?? ['claude'];
  const definitions = new Map();
  for (const level of [0, 1]) {
    for (const source of [...sources].reverse()) {
      if (!sourceFiles[source]) { warn(`unknown MCP source ${source}`); continue; }
      for (const [name, entry] of Object.entries(await readServers(sourceFiles[source][level], source, warn))) {
        definitions.set(name, { entry, source });
      }
    }
  }
  const servers = [];
  const names = new Set();
  for (const [name, { entry, source }] of definitions) {
    const server = await normalize(name, entry, source, cwd, credential, config, warn);
    if (!server) continue;
    if (names.has(server.serverName)) { warn(`MCP ${name}: duplicate normalized server name`); continue; }
    names.add(server.serverName);
    // A container-only interpreter script must not advertise tools on a native host.
    if (server.transport === 'stdio' && /^(?:node|node\.exe|python\d?(?:\.exe)?)$/i.test(basename(server.command))) {
      const script = server.args.find(argument => !argument.startsWith('-'));
      if (script && isAbsolute(script)) {
        try { if (!(await stat(script)).isFile()) throw new Error(); }
        catch { warn(`MCP ${name}: interpreter script is unavailable on this host`); continue; }
      }
    }
    servers.push(server);
  }
  return servers;
}

/** Mount native clients under each Agent identity, with parent-plugin and Agent disposal ownership. */
export async function mountSessionMcpServers(ctx, config) {
  const [{ createScope }, client] = await Promise.all([import('@deepseek-ai/dsh-scope'), import('@deepseek-ai/dsh-mcp-client')]);
  const states = new Map();
  let closed = false;
  const warn = message => console.warn(`dsh-claude-compat: ${message}`);
  const credential = async name => {
    if (process.env[name] !== undefined) return process.env[name];
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return;
    return (await ctx.get('credentials')?.resolve(name))?.value;
  };
  const dispose = async agent => {
    const state = states.get(agent);
    if (!state) return;
    states.delete(agent);
    state.closed = true;
    await state.scope.dispose();
  };
  const reconcile = agent => {
    if (closed || !agent.session.header.cwd) return Promise.resolve();
    let state = states.get(agent);
    if (!state) {
      state = { scope: createScope(ctx, agent), fibers: [], servers: [], warnings: [], connectionWarnings: [], lastCheck: undefined, signature: '', pending: undefined, closed: false };
      states.set(agent, state);
    }
    if (state.pending) return state.pending;
    state.pending = (async () => {
      const discoveryWarnings = [];
      const report = message => { discoveryWarnings.push(message); warn(message); };
      const discovered = await discoverProjectMcp(agent.session.header.cwd, config, { credential, warn: report });
      const servers = [];
      for (const server of discovered) {
        if (server.transport === 'stdio' && ctx.get('subprocess')) {
          try { await ctx.get('subprocess').resolveExecutable(server.command, server.env); }
          catch { report(`MCP ${server.serverName}: command is unavailable on this host`); continue; }
        }
        servers.push(server);
      }
      const signature = createHash('sha256').update(JSON.stringify(servers)).digest('hex');
      state.servers = servers.map(server => ({ name: server.serverName, transport: server.transport }));
      state.warnings = [...discoveryWarnings, ...state.connectionWarnings];
      if (closed || state.closed || signature === state.signature) return;
      for (const fiber of state.fibers) await fiber.dispose();
      state.fibers = [];
      state.connectionWarnings = [];
      await Promise.all(servers.map(async server => {
        if (closed || state.closed) return;
        try {
          const fiber = state.scope.ctx.plugin(client, server);
          state.fibers.push(fiber);
          await fiber;
        } catch (error) {
          if (!closed && !state.closed) {
            const message = `MCP ${server.serverName}: native client failed (${error?.code ?? error?.name ?? 'error'})`;
            state.connectionWarnings.push(message);
            warn(message);
          }
        }
      }));
      if (!state.closed) {
        state.signature = signature;
        state.lastCheck = new Date().toISOString();
        state.warnings = [...discoveryWarnings, ...state.connectionWarnings];
      }
    })().finally(() => { state.pending = undefined; });
    return state.pending;
  };
  ctx.on('agent/disposed', ({ agent }) => { void dispose(agent).catch(() => warn('project MCP disposal failed')); });
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    if (context.agent) await reconcile(context.agent);
    return next();
  }, { prepend: true });
  ctx.inject(['commands'], inner => {
    inner.commands.register({
      name: 'mcp-status',
      description: 'Show project MCP servers and registered tools for this chat',
      handler: async ({ agent }) => {
        if (!agent) return { kind: 'error', text: 'Open a project chat to inspect its MCP connections.' };
        await reconcile(agent);
        const state = states.get(agent);
        const tools = ctx.get('tools')?.schemas(agent) ?? [];
        const rows = (state?.servers ?? []).map(server => {
          const count = tools.filter(tool => tool.name.startsWith(`mcp__${server.name}__`)).length;
          return `${server.name}: ${count} tools registered${count === 0 ? '; no tools discovered, check connection warnings/logs' : ''}`;
        });
        return { kind: 'success', text: [
          `Project MCP — ${agent.session.header.cwd}`,
          `Last connection discovery: ${state?.lastCheck ?? 'not completed'}`,
          'Counts show registered tools; the native client does not expose continuous connection status.',
          ...rows.length > 0 ? rows : ['No project MCP servers are available.'],
          ...state?.warnings ?? [],
        ].join('\n') };
      },
    });
  });
  ctx.effect(() => async () => { closed = true; await Promise.all([...states.keys()].map(dispose)); });
}
