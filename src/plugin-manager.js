// Claude Code plugin operations. Reads use Claude's JSON registries; writes
// stay in the Claude CLI, under the caller's cwd and explicit configuration.
import { execFile, spawn } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { envPathList, envPluginDirs, resolveClaudePluginsRoot, resolveUserClaudeDir, isObject } from './lib.js';
import { readInstalledClaudePlugins } from './plugins.js';

const HELP = `# Claude Code Plugin Manager (dsh-claude-compat)

- \`/cc-plugin\` — open the native manager; \`/cc-plugin list\` lists installed plugins
- \`/cc-plugin install <name>[@marketplace]\` — install a plugin
- \`/cc-plugin <name>@<marketplace>\` — one-shot install
- \`/cc-plugin uninstall <name>\` — uninstall (alias: remove)
- \`/cc-plugin enable <name>\` / \`disable <name>\`
- \`/cc-plugin update <name>\`
- \`/cc-plugin search <term>\` — search local marketplace catalogs
- \`/cc-plugin marketplace list|add|remove|update [target]\`

Agents use the claude_compat tool with plugins.* actions and the session cwd.
The native Host service refreshes the skill catalog after successful changes.
Operations support user scope. The caller supplies the session cwd. CLI writes
use the configured Claude directory; failed CLI operations do not rewrite its
registries. Reload the skill catalog after plugin changes. Mounted plugin MCP
changes require a DSH restart.`;

const ACTIONS = new Set(['list', 'search', 'install', 'uninstall', 'enable', 'disable', 'update',
  'marketplace-list', 'marketplace-add', 'marketplace-remove', 'marketplace-update']);
const READ_ACTIONS = new Set(['list', 'search', 'marketplace-list']);
const REQUIRED_TARGET = new Set(['install', 'uninstall', 'enable', 'disable', 'update', 'marketplace-add', 'marketplace-remove']);
const PLUGIN_REF = /^[a-zA-Z0-9][a-zA-Z0-9._-]*(?:@[a-zA-Z0-9][a-zA-Z0-9._-]*)?$/;
const MARKET_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const MAX_OUTPUT = 1024 * 1024;
const mutationLocks = new Map();
// Unknown process-tree outcomes block later writes to the same resources.
// A restart is required after the operator has checked for surviving helpers.
const quarantinedResources = new Set();

function readJson(path, fallback) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!isObject(value)) throw new Error(`${path}: JSON root must be an object`);
    return value;
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

function locations(config = {}) {
  const userDir = resolveUserClaudeDir(config.userClaudeDir);
  const pluginsDir = resolveClaudePluginsRoot(config.pluginsRoot, config.userClaudeDir);
  return { userDir, pluginsDir, settingsPath: join(userDir, 'settings.json') };
}

function catalogPlugins(catalog) {
  return Array.isArray(catalog?.plugins) ? catalog.plugins.filter(isObject) : [];
}

/** Legacy human-output parser; unknown output must not establish an empty list. */
export function parsePluginList(output) {
  const plugins = [];
  let current;
  for (const line of String(output ?? '').split('\n')) {
    const entry = line.match(/^\s*❯\s*(\S+)@(\S+)\s*$/);
    if (entry) {
      if (current) plugins.push(current);
      current = { name: entry[1], marketplace: entry[2] };
      continue;
    }
    if (!current) continue;
    const version = line.match(/^\s*Version:\s*(\S+)/);
    const scope = line.match(/^\s*Scope:\s*(\S+)/);
    const status = line.match(/^\s*Status:\s*(✔|✘)\s*(\S+)/);
    if (version) current.version = version[1];
    if (scope) current.scope = scope[1];
    if (status) current.enabled = status[2] === 'enabled';
  }
  if (current) plugins.push(current);
  return plugins;
}

function diskPlugins(pluginsDir, settingsPath, strict = false) {
  const installed = readJson(join(pluginsDir, 'installed_plugins.json'), { plugins: {} });
  const settings = readJson(settingsPath, {});
  if (!isObject(installed.plugins) || (settings.enabledPlugins !== undefined && !isObject(settings.enabledPlugins))) {
    throw new Error('plugins and enabledPlugins must be objects');
  }
  const enabled = settings.enabledPlugins ?? {};
  if (strict && Object.values(enabled).some((value) => typeof value !== 'boolean')) throw new Error('enabledPlugins values must be boolean');
  return Object.entries(installed.plugins).flatMap(([key, entries]) => {
    if (strict && !Array.isArray(entries)) throw new Error(`Invalid installation records for ${key}`);
    const record = Array.isArray(entries) ? entries.findLast((item) => item?.scope === 'user') : undefined;
    if (!isObject(record)) return [];
    if (strict && (typeof record.installPath !== 'string' || !isAbsolute(record.installPath))) {
      throw new Error(`Invalid installPath for ${key}`);
    }
    const at = key.lastIndexOf('@');
    return [{ name: at > 0 ? key.slice(0, at) : key, marketplace: at > 0 ? key.slice(at + 1) : '',
      version: record.version, scope: record.scope, enabled: !Object.hasOwn(enabled, key) || enabled[key] === true }];
  });
}

/** Tolerant legacy reader. Structured operations report malformed JSON as failure. */
export function listFromDisk(pluginsDir, settingsPath) {
  try { return diskPlugins(pluginsDir, settingsPath); } catch { return []; }
}

function marketplaceHits(term, pluginsDir) {
  const marketRoot = join(pluginsDir, 'marketplaces');
  const needle = String(term ?? '').toLowerCase();
  let dirs;
  try { dirs = readdirSync(marketRoot, { withFileTypes: true }); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  const hits = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const catalog = readJson(join(marketRoot, dir.name, '.claude-plugin', 'marketplace.json'), {});
    for (const plugin of catalogPlugins(catalog)) {
      if (typeof plugin.name !== 'string') continue;
      const description = typeof plugin.description === 'string' ? plugin.description : '';
      const tags = Array.isArray(plugin.tags) ? plugin.tags.filter((tag) => typeof tag === 'string') : [];
      if (`${plugin.name} ${description} ${tags.join(' ')}`.toLowerCase().includes(needle)) {
        hits.push({ name: plugin.name, marketplace: dir.name, description,
          version: plugin.version, installId: `${plugin.name}@${dir.name}` });
      }
    }
  }
  return hits;
}

export function searchMarketplaces(term, pluginsDir) {
  try { return marketplaceHits(term, pluginsDir); } catch { return []; }
}

// These legacy exports no longer provide partial registry mutations. In
// particular an authentication/network failure must never become a disk install.
export async function fallbackInstall() {
  return { ok: false, error: 'Fallback source installation is not supported; install with the Claude CLI.' };
}

export function fallbackToggle() {
  return { ok: false, error: 'Fallback settings changes are not supported; use the Claude CLI.' };
}

function validateRequest(request) {
  if (!isObject(request)) throw new Error('request must be an object');
  for (const key of Object.keys(request)) {
    if (!['action', 'target', 'query', 'scope', 'cwd'].includes(key)) throw new Error(`Unknown request field: ${key}`);
  }
  if (!ACTIONS.has(request.action)) throw new Error('Unsupported plugin action');
  for (const field of ['target', 'query', 'scope', 'cwd']) {
    if (request[field] !== undefined && (typeof request[field] !== 'string' || (field !== 'query' && !request[field].trim()) || /[\x00-\x1f\x7f]/.test(request[field]))) {
      throw new Error(`${field} must be a nonempty string without control characters`);
    }
  }
  if (request.scope !== undefined && request.scope !== 'user') throw new Error('Only user scope is supported; project/local scope is not bridged');
  if (REQUIRED_TARGET.has(request.action) && request.target === undefined) throw new Error(`${request.action} requires target`);
  if (request.action === 'search' && request.query === undefined) throw new Error('search requires query');
  if (request.query !== undefined && request.action !== 'search') throw new Error('query is only accepted for search');
  if (request.target !== undefined) {
    if (['list', 'search', 'marketplace-list'].includes(request.action)) throw new Error(`${request.action} does not accept target`);
    if (request.action === 'marketplace-add') {
      if (request.target.startsWith('-') || request.target.trim() !== request.target || request.target.length > 4096) throw new Error('Invalid marketplace source');
      const source = request.target;
      if (!isAbsolute(source) && !/^[\w.-]+\/[\w.-]+$/.test(source) && !/^https?:\/\/\S+$/.test(source) && !/^git@[\w.-]+:[\w./-]+$/.test(source)) {
        throw new Error('marketplace source must be owner/repo, an HTTP(S)/SSH URL, or an absolute directory');
      }
    } else if (!(request.action.startsWith('marketplace-') ? MARKET_NAME : PLUGIN_REF).test(request.target)) {
      throw new Error('Invalid plugin or marketplace target');
    }
  }
  const cwd = request.cwd ?? process.cwd();
  if (!isAbsolute(cwd) || !statSync(cwd).isDirectory()) throw new Error('cwd must name an existing absolute directory');
  return { ...request, cwd: resolve(cwd) };
}

function managementPlugins(pluginsDir, userDir, settingsPath) {
  diskPlugins(pluginsDir, settingsPath, true);
  for (const seed of envPathList('CLAUDE_CODE_PLUGIN_SEED_DIR')) {
    if (readJson(join(seed, 'installed_plugins.json'), undefined) === undefined) throw new Error(`Seed plugin registry is missing: ${seed}`);
    diskPlugins(seed, settingsPath, true);
  }
  const inline = envPluginDirs();
  if (inline.skipped.length) throw new Error('Inline plugin directories must be absolute');
  for (const path of inline.dirs) {
    if (!statSync(path).isDirectory()) throw new Error(`Inline plugin directory is unavailable: ${path}`);
  }
  return readInstalledClaudePlugins(pluginsDir, userDir, { includeDisabled: true }).map((plugin) => {
    const writable = plugin.sourceKind === 'primary';
    return { ...plugin, operationTarget: writable ? plugin.key : null,
      capabilities: { enable: writable, disable: writable, update: writable, uninstall: writable } };
  });
}

function lockIdentity(path) {
  try { return realpathSync(path); }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const parent = dirname(path);
    return parent === path ? path : join(lockIdentity(parent), basename(path));
  }
}

function aborted(signal) {
  if (signal?.aborted) throw new Error('Plugin operation cancelled');
}

function waitFor(promise, signal) {
  if (!signal) return promise;
  aborted(signal);
  return new Promise((resolveWait, reject) => {
    const onAbort = () => reject(new Error('Plugin operation cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolveWait, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

// Lock both shared resources. Different user dirs may share a cache, and
// different caches may share settings. Queued cancellation never releases a
// predecessor's ownership; the CLI must settle before its successor starts.
async function withMutationLocks(paths, signal, operation) {
  const releases = [];
  try {
    for (const key of [...new Set(paths)].sort()) {
      const previous = mutationLocks.get(key) ?? Promise.resolve();
      let release;
      const gate = new Promise((done) => { release = done; });
      const tail = previous.then(() => gate);
      mutationLocks.set(key, tail);
      releases.push(() => {
        release();
        // An aborted waiter may still have a live predecessor. Keep its tail
        // in the map until that predecessor also releases the resource.
        void tail.then(() => {
          if (mutationLocks.get(key) === tail) mutationLocks.delete(key);
        });
      });
      await waitFor(previous, signal);
    }
    aborted(signal);
    if (paths.some((path) => quarantinedResources.has(path))) {
      throw Object.assign(new Error('Previous CLI process-tree status is unknown; check surviving processes and restart DSH before more plugin writes'), { unknown: true });
    }
    return await operation();
  } finally {
    for (const release of releases.reverse()) release();
  }
}

function emit(callback, event) {
  // Progress is advisory; a broken observer must not change a CLI outcome.
  try { callback?.(event); } catch { /* observer failure is isolated */ }
}

function claudePlugin(args, timeoutMs, { cwd, env, signal, onProgress }) {
  return new Promise((resolveRun) => {
    let result;
    let child;
    let stopping;
    let timer;
    let cleanupDeadline;
    let cleanupError;
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(cleanupDeadline);
      signal?.removeEventListener('abort', onAbort);
      resolveRun(cleanupError ? { ok: false, unknown: true, error: cleanupError } : outcome);
    };
    const cleanupFailure = (error) => {
      cleanupError = `CLI process-tree status is unknown: ${error.message}`;
      try { child.kill('SIGKILL'); } catch { /* the resources will remain isolated */ }
    };
    const stopTree = () => {
      if (stopping || !child?.pid) return stopping ?? Promise.resolve();
      cleanupDeadline = setTimeout(() => {
        cleanupFailure(new Error('process cleanup did not settle within its deadline'));
        finish({ ok: false });
      }, 12000);
      cleanupDeadline.unref();
      stopping = process.platform === 'win32'
        ? new Promise((done) => execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { timeout: 10000 }, (error) => {
          if (error) cleanupFailure(error);
          done();
        }))
        : Promise.resolve().then(() => {
          try { process.kill(-child.pid, 'SIGKILL'); }
          catch (error) { if (error.code !== 'ESRCH') cleanupFailure(error); }
        });
      // This promise is joined before settlement; attach a rejection observer
      // now as an abort event can precede the process close event.
      stopping.catch(() => {});
      return stopping;
    };
    const output = { stdout: [], stderr: [] };
    let outputBytes = 0;
    const stop = (reason) => {
      result ??= { ok: false, error: reason };
      void stopTree();
    };
    const onAbort = () => stop('Plugin operation cancelled');
    try {
      child = spawn('claude', ['plugin', ...args], {
        cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolveRun({ ok: false, error: error.message, code: error.code });
      return;
    }
    timer = setTimeout(() => stop('Claude CLI timed out'), timeoutMs);
    timer.unref();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.once('error', (error) => { result = { ok: false, error: error.message, code: error.code }; });
    for (const [stream, pipe] of [['stdout', child.stdout], ['stderr', child.stderr]]) {
      pipe?.setEncoding('utf8');
      pipe?.on('data', (text) => {
        outputBytes += Buffer.byteLength(text);
        if (outputBytes > MAX_OUTPUT) { stop('Claude CLI output exceeded the limit'); return; }
        output[stream].push(text);
        emit(onProgress, { phase: 'output', stream, text: text.slice(0, 16384) });
      });
    }
    child.once('exit', () => {
      // POSIX helpers remain in our process group even after their parent
      // exits. Retire them before close can publish an operation outcome.
      if (process.platform !== 'win32') void stopTree();
    });
    child.once('close', async (code) => {
      try {
        await stopping;
        finish(result ?? (code === 0 ? { ok: true, stdout: output.stdout.join('') }
          : { ok: false, error: output.stderr.join('').trim() || `Claude CLI exited with code ${code}` }));
      } catch (error) {
        cleanupFailure(error);
        finish({ ok: false });
      }
    });
  });
}

function cliArgs({ action, target }) {
  if (action.startsWith('marketplace-')) return ['marketplace', action.slice('marketplace-'.length), ...(target ? [target] : [])];
  return [action, ...(target ? [target] : []), '--scope', 'user'];
}

function listText(items) {
  return ['# Claude Code Plugin Manager', '', items.length ? 'Installed plugins:' : 'No plugins installed.',
    ...items.map((item) => `- **${item.key ?? `${item.name}@${item.marketplace}`}** v${item.version ?? '?'} [${item.scope ?? 'user'}] ${item.enabled ? '✔ enabled' : '✘ disabled'}`)].join('\n');
}

/**
 * Run one user-scope operation. Injected CLI adapters receive
 * (args, timeoutMs, { cwd, env, signal, onProgress }) and return {ok, stdout?, error?}.
 * Progress events carry phase queued/running/output/completed/failed.
 */
export async function runPluginOperation(request, deps = {}) {
  const action = typeof request?.action === 'string' ? request.action : '';
  if (!isObject(deps)) return { ok: false, action, error: 'dependencies must be an object' };
  try {
    const input = validateRequest(request);
    if (deps.claude !== undefined && typeof deps.claude !== 'function') throw new Error('claude dependency must be a function');
    if (deps.onProgress !== undefined && typeof deps.onProgress !== 'function') throw new Error('onProgress must be a function');
    if (deps.signal !== undefined && !(deps.signal instanceof AbortSignal)) throw new Error('signal must be an AbortSignal');
    aborted(deps.signal);
    const { userDir, pluginsDir, settingsPath } = locations(deps.config);
    if (action === 'list') {
      // Validate JSON before discovery, whose warning-and-skip behavior is
      // appropriate for catalog reconciliation but not for a management query.
      const items = managementPlugins(pluginsDir, userDir, settingsPath);
      return { ok: true, action, items, engine: 'disk', text: listText(items) };
    }
    if (action === 'search') {
      const items = marketplaceHits(input.query, pluginsDir);
      return { ok: true, action, items, engine: 'disk', text: items.length
        ? items.map((item) => `${item.installId} — ${item.description}`).join('\n') : `No marketplace plugin matches "${input.query}".` };
    }
    const marketsPath = join(pluginsDir, 'known_marketplaces.json');
    if (action === 'marketplace-list' && !deps.claude) {
      const known = readJson(marketsPath, {});
      const items = Object.entries(known).map(([name, value]) => ({ name, ...isObject(value) ? value : {} }));
      return { ok: true, action, items, engine: 'disk', text: items.length ? items.map((item) => item.name).join('\n') : 'No marketplaces registered.' };
    }
    const writeResources = [lockIdentity(userDir), lockIdentity(pluginsDir)];
    const run = async () => {
      aborted(deps.signal);
      emit(deps.onProgress, { action, phase: 'running' });
      const env = { ...process.env, CLAUDE_CONFIG_DIR: userDir, CLAUDE_CODE_PLUGIN_CACHE_DIR: pluginsDir };
      const response = await (deps.claude ?? claudePlugin)(cliArgs(input), 300_000,
        { cwd: input.cwd, env, signal: deps.signal, onProgress: (event) => emit(deps.onProgress, { ...event, action }) });
      if (!isObject(response) || typeof response.ok !== 'boolean') throw new Error('Claude CLI returned an invalid outcome');
      if (response.unknown === true) {
        for (const path of writeResources) quarantinedResources.add(path);
        throw Object.assign(new Error(response.error ?? 'CLI process-tree status is unknown'), { unknown: true });
      }
      if (deps.signal?.aborted) throw new Error('Plugin operation cancelled');
      if (!response.ok) {
        const reason = typeof response.error === 'string' ? response.error : 'Claude CLI failed';
        const missing = response.code === 'ENOENT' || /spawn claude ENOENT/.test(reason);
        throw new Error(missing ? `${reason}. Install the Claude CLI; disk mutation fallback is not supported.` : reason);
      }
      const restartRequired = !READ_ACTIONS.has(action) && !action.startsWith('marketplace-') && deps.config?.enablePluginMcp === true;
      const text = typeof response.stdout === 'string' && response.stdout.trim() ? response.stdout.trim() : `${action} completed.`;
      emit(deps.onProgress, { action, phase: 'completed' });
      return { ok: true, action, engine: 'claude CLI', text, restartRequired };
    };
    if (READ_ACTIONS.has(action)) return await run();
    emit(deps.onProgress, { action, phase: 'queued' });
    return await withMutationLocks(writeResources, deps.signal, async () => {
      if (['enable', 'disable', 'uninstall', 'update'].includes(action)) {
        const selected = managementPlugins(pluginsDir, userDir, settingsPath)
          .filter((plugin) => plugin.key === input.target || plugin.name === input.target);
        if (selected.length && selected.every((plugin) => plugin.sourceKind !== 'primary')) {
          throw new Error('Seed and inline plugins are read-only; change their source configuration instead');
        }
      }
      return run();
    });
  } catch (error) {
    const reason = error?.message ?? String(error);
    emit(deps.onProgress, { action, phase: 'failed', text: reason });
    return { ok: false, action, error: reason, text: reason, ...(error?.unknown === true ? { unknown: true } : {}) };
  }
}

/** Backward-compatible text surface; callers needing status use runPluginOperation. */
export async function runPluginCommand(input, deps = {}) {
  if (typeof input !== 'string' && input !== undefined && input !== null) return 'Plugin command must be text';
  const args = String(input ?? '').trim().split(/\s+/).filter(Boolean);
  if (args[0] === 'help') return HELP;
  let [action = 'list', ...rest] = args;
  if (action === 'remove') action = 'uninstall';
  if (action === 'marketplace') {
    const [sub, ...targets] = rest;
    action = `marketplace-${sub === 'rm' ? 'remove' : sub}`;
    rest = targets;
  } else if (!ACTIONS.has(action)) {
    rest = [action, ...rest];
    action = 'install';
  }
  const request = { action, ...(deps.cwd ? { cwd: deps.cwd } : {}) };
  if (action === 'search') request.query = rest.join(' ');
  else if (rest.length > 0) request.target = rest.join(' ');
  const result = await runPluginOperation(request, deps);
  return result.ok ? result.text ?? `${action} completed.` : `${action} failed: ${result.error}`;
}

export const PLUGIN_SKILL_NAME = 'plugin';
export const PLUGIN_SKILL_BODY = HELP;
