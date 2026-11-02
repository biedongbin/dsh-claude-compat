// Project MCP discovery for a multi-session Desktop. Connections and tool names
// belong to the Agent scope; source files and credentials are read again before
// prompt assembly so another project or a changed credential cannot reuse them.
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve, posix, win32 } from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import { findProjectRootSync } from './lib.js';
import { RealmReader } from './native-provider.js';

const REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

async function readServers(filename, source, warn, reader) {
  if (!filename) return {};
  let text;
  try { text = reader ? await reader.text(filename) : await readFile(filename, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') warn(`cannot read MCP configuration ${filename}`); return {}; }
  if (text === undefined) return {};
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

async function normalize(name, entry, source, cwd, credential, config, warn, paths = {resolve}) {
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
    const directory = typeof entry.cwd === 'string' ? paths.resolve(cwd, await expand(entry.cwd, credential, missing)) : cwd;
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
  const reader = options.fs ? new RealmReader(options.fs, options.signal) : undefined;
  const home = reader ? options.home : options.home ?? homedir();
  const paths = reader ? (/^[A-Za-z]:[\\/]|^\\\\/.test(cwd) ? win32 : posix) : {join,resolve,basename,isAbsolute};
  if(reader&&!options.projectRoot)throw new Error('Native MCP discovery requires the configured realm project root');
  const root = options.projectRoot ?? (findProjectRootSync(cwd, config.projectRootMarkers) ?? cwd);
  const sourceFiles = {
    dsh: [home && paths.join(home, '.dsh', 'mcp.json'), paths.join(root, '.dsh', 'mcp.json')],
    claude: [home && paths.join(home, '.claude.json'), paths.join(root, '.mcp.json')],
    codex: [home && paths.join(home, '.codex', 'config.toml'), paths.join(root, '.codex', 'config.toml')],
    agents: [home && paths.join(home, '.agents', 'mcp.yaml'), paths.join(root, '.agents', 'mcp.yaml')],
  };
  const sources = config.mcpSources ?? ['claude'];
  const localNames={dsh:'.dsh/mcp.json',claude:'.mcp.json',codex:'.codex/config.toml',agents:'.agents/mcp.yaml'};
  const definitions = new Map();
  for (const level of [0, 1]) {
    for (const source of [...sources].reverse()) {
      if (!sourceFiles[source]) { warn(`unknown MCP source ${source}`); continue; }
      for (const [name, entry] of Object.entries(await readServers(sourceFiles[source][level], source, warn, reader))) {
        definitions.set(name, { entry, source });
      }
    }
  }
  // Installation-local files omitted from Git remain available to a task's
  // checkout; versioned settings never fall back to another branch's policy.
  for(const source of [...sources].reverse()) {
    const filename=options.localProjectFiles?.[localNames[source]];
    if(!filename)continue;
    for(const[name,entry]of Object.entries(await readServers(filename,source,warn,reader)))definitions.set(name,{entry,source});
  }
  const servers = [];
  const names = new Set();
  for (const [name, { entry, source }] of definitions) {
    const server = await normalize(name, entry, source, options.executionCwd ?? cwd, credential, config, warn, paths);
    if (!server) continue;
    if (names.has(server.serverName)) { warn(`MCP ${name}: duplicate normalized server name`); continue; }
    names.add(server.serverName);
    // A container-only interpreter script must not advertise tools on a native host.
    if (server.transport === 'stdio' && /^(?:node|node\.exe|python\d?(?:\.exe)?)$/i.test(paths.basename(server.command))) {
      const script = server.args.find(argument => !argument.startsWith('-'));
      if (script && paths.isAbsolute(script)) {
        try { if (reader ? (await reader.stat(script))?.type !== 'file' : !(await stat(script)).isFile()) throw new Error(); }
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
      state = { scope: createScope(config.nativeRealm === true ? agent.ctx : ctx, agent), fibers: [], servers: [], warnings: [], connectionWarnings: [], lastCheck: undefined, signature: '', pending: undefined, closed: false };
      states.set(agent, state);
    }
    if (state.pending) return state.pending;
    state.pending = (async () => {
      const discoveryWarnings = [];
      const report = message => { discoveryWarnings.push(message); warn(message); };
      const realm = config.nativeRealm === true ? await ctx.get('platformProjectConfig').resolve(agent) : undefined;
      const projectCredential = realm ? name => ctx.get('platformProjectConfig').resolveCredential(agent, name) : credential;
      const localProjectFiles=realm?await ctx.get('platformProjectConfig').localProjectFiles(agent,['.dsh/mcp.json','.mcp.json','.codex/config.toml','.agents/mcp.yaml']):undefined;
      const discovered = await discoverProjectMcp(realm?.checkoutRoot ?? agent.session.header.cwd, config, {
        credential: projectCredential, warn: report,
        ...(realm ? {fs: realm.fs, home: realm.userConfigRoot, projectRoot: realm.checkoutRoot, executionCwd: realm.cwd,localProjectFiles} : {}),
      });
      const servers = [];
      for (const server of discovered) {
        const processes = realm?.subprocess ?? ctx.get('subprocess');
        if (server.transport === 'stdio' && processes) {
          try { await processes.resolveExecutable(server.command, server.env); }
          catch { report(`MCP ${server.serverName}: command is unavailable in this execution realm`); continue; }
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
          if (config.nativeRealm === true) await fiber.inertia;
          else await fiber;
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
        const tools = (ctx.get('agentPresets')?.serviceFor(agent,'tools') ?? agent.ctx.get('tools'))?.schemas(agent) ?? [];
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
