// One operation service for the native pages, slash commands and agent tool.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolveUserClaudeDir, resolveClaudePluginsRoot } from './lib.js';
import { runPluginOperation } from './plugin-manager.js';
import { createSessionHandoffService } from './session-handoff.js';
import { serviceOf, loadClientRequestSchema } from './compat.js';

const PLUGIN_READS = new Set(['list', 'search', 'marketplace-list']);
const SESSION_ACTIONS = new Map([
  ['sessions.projects', 'listProjects'], ['sessions.list', 'listSessions'],
  ['sessions.preview', 'preview'], ['sessions.import', 'importSession'],
]);
export const COMPAT_ACTIONS = [
  'status', 'reload', 'sessions.resume', ...SESSION_ACTIONS.keys(),
  ...['list', 'search', 'install', 'uninstall', 'enable', 'disable', 'update',
    'marketplace-list', 'marketplace-add', 'marketplace-remove', 'marketplace-update'].map((a) => `plugins.${a}`),
];
export function isCompatMutation(action) {
  return action === 'reload' || action === 'sessions.import' || action === 'sessions.resume'
    || (action?.startsWith('plugins.') && !PLUGIN_READS.has(action.slice(8)));
}
export function operationKey(request) {
  if (request.action?.startsWith('plugins.marketplace-')) return JSON.stringify(['marketplace', request.target ?? '*']);
  if (request.action?.startsWith('plugins.')) return JSON.stringify(['plugin', request.target ?? '*']);
  if (request.action === 'sessions.resume') return JSON.stringify(['handoff', request.cwd ?? '', request.sessionId ?? '', request.targetSessionId ?? 'new']);
  if (request.action === 'sessions.import') return JSON.stringify(['session', request.cwd ?? '', request.sessionId ?? '']);
  return JSON.stringify([request.action]);
}
const REQUEST_FIELDS = new Set(['action', 'cwd', 'target', 'query', 'sessionId', 'scope', 'limit', 'offset', 'limitTurns', 'newSnapshot', 'targetSessionId']);
const ACTIVE_STATES = new Set(['queued', 'running']);
const MAX_ACTIVE_JOBS = 20;
const MAX_TERMINAL_JOBS = 20;
function requestSnapshot(input) {
  requestObject(input);
  if (!Object.hasOwn(input, 'action')) throw new Error('Operation action must be an own request field');
  const snapshot = {};
  for (const key of Object.keys(input).sort()) {
    if (!REQUEST_FIELDS.has(key)) throw new Error(`Unknown operation request field: ${key}`);
    const value = input[key];
    if (value === undefined) continue;
    if (!['string', 'boolean', 'number'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) {
      throw new Error(`${key} must be a JSON scalar`);
    }
    snapshot[key] = value;
  }
  return Object.freeze(snapshot);
}
function requestObject(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || !COMPAT_ACTIONS.includes(request.action)) throw new Error('Unknown Claude compatibility action');
  for (const key of ['cwd', 'target', 'query', 'sessionId', 'scope', 'targetSessionId']) {
    if (request[key] !== undefined && (typeof request[key] !== 'string' || request[key].length > 8192)) {
      throw new Error(`${key} must be a string of at most 8192 characters`);
    }
  }
  return request;
}
export function createCompatibilityService(ctx, config, invalidate, deps = {}) {
  let sessionService;
  const handoffs = createSessionHandoffService(ctx, config, async (request, signal) => (await sessions()).prepareHandoff(request, signal));
  let revision = 0;
  const generation = randomUUID();
  const jobs = new Map();
  const receipts = new Map();
  const activeKeys = new Map();
  const history = [];
  const pending = new Set();
  const lifetime = new AbortController();
  const pluginOperation = deps.pluginOperation ?? runPluginOperation;
  async function sessions() {
    sessionService ??= deps.sessionService ?? (await import('./session-import.js')).createSessionImportService({
      get sessionPersistence() { return serviceOf(ctx, 'sessionPersistence'); },
    }, config);
    return sessionService;
  }
  async function perform(input, signal, onProgress, operationId) {
    const request = requestObject(input);
    signal.throwIfAborted();
    if (request.action === 'status') {
      const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
      const agent = request.sessionId ? ctx.get?.('agents')?.get(request.sessionId) : undefined;
      const cwd = agent ? (ctx.get?.('workingDirectory')?.get(agent.session) ?? agent.session.header.cwd) : process.cwd();
      let transport;
      const connection = serviceOf(ctx, 'connection');
      if (connection) {
        try {
          // Probe the live Desktop/API dispatch table without reading any credentials.
          const response = await connection.createSharedFetchHandler('/api').fetch(new Request('http://dsh.internal/api/claude-compat', {
            method: 'POST', headers: { 'content-type': 'application/json' }, signal,
            body: JSON.stringify({ type: 'client-request', rpcId: 'compat-route-probe', method: 'claude-compat', payload: { action: 'operation.active' } }),
          }), connection.browserPeer);
          const envelope = response.status === 200 ? await response.json() : null;
          transport = { path: '/api/claude-compat', httpStatus: response.status,
            ready: envelope?.type === 'server-response' && envelope.result?.ok === true };
        } catch (error) { transport = { path: '/api/claude-compat', ready: false, error: error.message }; }
      }
      return { ok: true, version: manifest.version, cwd, ...(transport ? { transport } : {}),
        userClaudeDir: resolveUserClaudeDir(config.userClaudeDir),
        pluginsRoot: resolveClaudePluginsRoot(config.pluginsRoot, config.userClaudeDir),
        nativeSessions: Boolean(serviceOf(ctx, 'sessionPersistence')),
        contextHandoff: Boolean(serviceOf(ctx, 'sessionController')),
        features: { skills: config.enableSkills !== false, rules: config.enableRules !== false,
          hooks: config.enableHooks !== false, mcp: config.enableMcp !== false,
          pluginMcp: config.enablePluginMcp === true },
      };
    }
    if (request.action === 'reload') {
      invalidate();
      return { ok: true, catalogRefreshed: true, text: 'Skill catalog refreshed. MCP and hook changes require a DSH restart.' };
    }
    if (request.action === 'sessions.resume') return handoffs.resume(request, signal, onProgress, operationId);
    if (SESSION_ACTIONS.has(request.action)) {
      onProgress('Reading Claude Code history');
      const result = await (await sessions())[SESSION_ACTIONS.get(request.action)](request, signal);
      if (request.action === 'sessions.import') {
        const registry = serviceOf(ctx, 'workspaceRegistry');
        if (registry && result.cwd) {
          try {
            const workspace = await registry.create(result.cwd);
            await workspace.attachSession(result.sessionId);
          } catch (error) {
            return { ...result, ok: true, warnings: [...(result.warnings ?? []),
              `History was imported, but the workspace could not be linked: ${error.message}`] };
          }
        }
      }
      return { ...result, ok: true };
    }
    const action = request.action.slice(8);
    const { limit, offset, query, ...operation } = request;
    const result = await pluginOperation({ ...operation, action, ...(action === 'search' ? { query: query ?? '' } : {}) }, { config, signal, onProgress });
    if (result.ok && Array.isArray(result.items)) {
      const pageSize = limit ?? 10, startAt = offset ?? 0;
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isInteger(startAt) || startAt < 0) throw new Error('Invalid plugin page range');
      const needle = (query ?? '').toLocaleLowerCase();
      const items = needle ? result.items.filter((item) => `${item.name} ${item.description ?? ''} ${item.marketplace ?? ''}`.toLocaleLowerCase().includes(needle)) : result.items;
      const { text: _fullListing, ...page } = result;
      return { ...page, items: items.slice(startAt, startAt + pageSize), total: items.length,
        hasMore: startAt + pageSize < items.length, offset: startAt };
    }
    if (result.ok && !PLUGIN_READS.has(action)) {
      invalidate();
      return { ...result, catalogRefreshed: true };
    }
    return result;
  }
  async function tracked(input, callerSignal, onProgress = () => {}, operationId) {
    const signal = AbortSignal.any([lifetime.signal, ...(callerSignal ? [callerSignal] : [])]);
    // Register ownership before adapters or observers can synchronously dispose the service.
    const promise = Promise.resolve().then(() => perform(input, signal, onProgress, operationId));
    pending.add(promise);
    try { return await promise; } finally { pending.delete(promise); }
  }
  function touch(job) { job.revision = ++revision; }
  function firstActive() { return [...jobs.values()].find((job) => ACTIVE_STATES.has(job.state)); }
  function jobView(job, brief = false) {
    const result = job.result === undefined ? undefined : structuredClone(job.result);
    const truncated = brief && (job.progress.length > 2000 || (typeof result?.text === 'string' && result.text.length > 2000));
    if (brief && typeof result?.text === 'string') result.text = result.text.slice(-2000);
    return { id: job.id, key: job.key, generation, state: job.state, action: job.request.action,
      ...Object.fromEntries(['target', 'cwd', 'sessionId', 'targetSessionId'].filter((key) => job.request[key] !== undefined).map((key) => [key, job.request[key]])),
      progress: brief ? job.progress.slice(-2000) : job.progress,
      ...(result === undefined ? {} : { result }), revision: job.revision, createdAt: job.createdAt,
      ...(truncated ? { detailsTruncated: true } : {}),
    };
  }
  function attachReceipt(job, id) {
    receipts.set(id, job);
    job.receipts.add(id);
  }
  function finish(job, value) {
    try {
      job.result = value && typeof value === 'object' && typeof value.ok === 'boolean'
        ? structuredClone(value) : { ok: false, error: 'Operation returned an invalid result' };
    } catch { job.result = { ok: false, error: 'Operation returned an unsupported result' }; }
    const handedOff = job.request.action === 'sessions.resume' && job.result.ok && job.result.accepted === true;
    job.state = job.result.unknown ? 'failed' : handedOff ? 'done' : job.signal.aborted ? 'cancelled' : job.result.ok ? 'done' : 'failed';
    touch(job);
    if (activeKeys.get(job.key) === job) activeKeys.delete(job.key);
    history.push(job.id);
    while (history.length > MAX_TERMINAL_JOBS) {
      const id = history.shift();
      const previous = jobs.get(id);
      // Active jobs are never candidates for history eviction.
      if (!previous || ACTIVE_STATES.has(previous.state)) continue;
      for (const receipt of previous.receipts) receipts.delete(receipt);
      jobs.delete(id);
    }
  }
  function admit(input, caller = {}, id) {
    const request = requestSnapshot(input);
    const fingerprint = JSON.stringify(request);
    lifetime.signal.throwIfAborted();
    if (id !== undefined && (typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) {
      throw new Error('Operation id must be a UUID');
    }
    const previous = id === undefined ? undefined : receipts.get(id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new Error('Operation id already belongs to a different request');
      return { job: previous, created: false };
    }
    const key = operationKey(request);
    const active = activeKeys.get(key);
    if (active) {
      if (active.fingerprint !== fingerprint) throw new Error('A different operation for this item is already queued or running');
      if (id !== undefined) attachReceipt(active, id);
      return { job: active, created: false };
    }
    if (activeKeys.size >= MAX_ACTIVE_JOBS) throw new Error('At most 20 operations may be queued or running; wait for a task to finish or cancel one.');
    caller.signal?.throwIfAborted();
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, lifetime.signal, ...(caller.signal ? [caller.signal] : [])]);
    const job = { id: id ?? randomUUID(), key, request, fingerprint, controller, signal,
      state: request.action.startsWith('plugins.') && isCompatMutation(request.action) ? 'queued' : 'running',
      progress: '', createdAt: Date.now(), receipts: new Set(),
    };
    jobs.set(job.id, job);
    activeKeys.set(key, job);
    attachReceipt(job, job.id);
    touch(job);
    job.promise = tracked(request, signal, (event) => {
      if (!ACTIVE_STATES.has(job.state)) return;
      const phase = event && typeof event === 'object' ? event.phase : undefined;
      if (!signal.aborted) {
        if (phase === 'queued') job.state = 'queued';
        else if (phase === 'running' || phase === 'output' || phase === 'outputs') job.state = 'running';
      }
      const line = typeof event === 'string' ? event : (event?.text ?? phase ?? '');
      job.progress = `${job.progress}${job.progress && line ? '\n' : ''}${line}`.slice(-12_000);
      touch(job);
      try { caller.onProgress?.(event); }
      catch (error) { console.warn('claude-compat: progress observer failed:', error?.message ?? String(error)); }
    }, job.id).then((result) => finish(job, result), (error) => finish(job, {
      ok: false, error: error?.message ?? String(error), ...(error?.unknown ? { unknown: true } : {}),
    }));
    return { job, created: true };
  }
  async function waitForJob(job, signal) {
    signal?.throwIfAborted();
    if (!signal) return job.promise;
    let abort;
    try {
      await Promise.race([job.promise, new Promise((_resolve, reject) => {
        abort = () => reject(signal.reason ?? new Error('Operation wait cancelled'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      })]);
    } finally { signal.removeEventListener('abort', abort); }
  }
  async function execute(input, signal, onProgress) {
    const request = requestSnapshot(input);
    // Polling and ordinary reads run independently without evicting write receipts.
    if (!isCompatMutation(request.action)) return tracked(request, signal, onProgress);
    const { job, created } = admit(request, { signal, onProgress });
    if (created) await job.promise; // The owning caller waits for its cancellation cleanup.
    else await waitForJob(job, signal); // A duplicate caller may stop waiting, never abort the original job.
    return structuredClone(job.result);
  }
  async function call(input, signal) {
    if (input?.action === 'operation.start') return jobView(admit(input.request, {}, input.id).job);
    if (input?.action === 'operation.list') return { generation, revision, items: [...jobs.values()].map((job) => jobView(job, true)) };
    if (input?.action === 'operation.active') { const job = firstActive(); return job ? jobView(job) : null; }
    if (input?.action === 'operation.status' || input?.action === 'operation.cancel') {
      const job = receipts.get(input.id);
      if (!job) throw new Error('Operation is unavailable; refresh the list to check its outcome.');
      if (input.action === 'operation.cancel' && ACTIVE_STATES.has(job.state)) {
        job.controller.abort(new Error('Operation cancelled'));
        await job.promise;
      }
      return jobView(job);
    }
    return execute(input, signal);
  }
  async function dispose() {
    lifetime.abort();
    for (const job of jobs.values()) job.controller.abort();
    await Promise.allSettled([...pending, ...[...jobs.values()].map((job) => job.promise)]);
    if (jobs.size) revision += 1;
    jobs.clear(); receipts.clear(); activeKeys.clear(); history.length = 0;
  }
  return { execute, call, dispose };
}

export function registerCompatibilityService(ctx, config, invalidate) {
  const service = createCompatibilityService(ctx, config, invalidate);
  ctx.effect?.(() => () => service.dispose());
  // Gateway owns /api's singleton RPC interceptor. Exact Fetch routes coexist
  // with it, and are also forwarded by the Desktop carrier. Connection performs
  // authentication, Host/Origin checks and owner-only admission before fetch.
  ctx.inject?.(['connection'], (wireCtx) => {
    wireCtx.connection.fetch.register({
      path: '/api/claude-compat', methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          return new Response('content type must be application/json', { status: 415 });
        }
        let body;
        try { body = await request.json(); }
        catch { return new Response('body is not JSON', { status: 400 }); }
        // Both supported releases export clientRequestSchema. If the module is
        // unavailable, the fallback still checks the RPC method name.
        const schema = await loadClientRequestSchema();
        const parsed = schema === undefined ? undefined : schema.safeParse(body);
        const envelope = parsed === undefined ? body : parsed.data;
        const rpcId = typeof body?.rpcId === 'string' ? body.rpcId : 'invalid-request';
        const reply = (result) => Response.json({ type: 'server-response', rpcId, result });
        if ((parsed !== undefined && !parsed.success) || envelope?.method !== 'claude-compat') {
          return reply({ ok: false, error: { code: 'gateway/bad-request', message: 'Invalid Claude compatibility RPC envelope.', details: {} } });
        }
        try { return reply({ ok: true, value: await service.call(envelope.payload, request.signal) }); }
        catch (error) {
          return reply({ ok: false, error: { code: 'claude-compat/operation-failed', message: error.message, details: {} } });
        }
      },
    });
  });
  ctx.inject?.(['tools'], (toolCtx) => {
    toolCtx.tools.register({
      name: 'claude_compat',
      description: 'Browse Claude Code history. sessions.resume sends a short file-reference prompt asking DSH to read and summarize background, task state and next steps. Manage plugins and marketplaces, inspect status or refresh skills. sessions.import creates a separate legacy archive.',
      parameters: { type: 'object', properties: {
        action: { type: 'string', enum: COMPAT_ACTIONS },
        cwd: { type: 'string', description: 'Absolute project directory; defaults to the current session directory.' },
        target: { type: 'string', description: 'Exact plugin or marketplace identifier for plugin operations.' },
        query: { type: 'string' }, sessionId: { type: 'string', description: 'Claude source session identifier for history actions; DSH session identifier for status.' },
        targetSessionId: { type: 'string', description: 'For sessions.resume, continue in this existing DSH session. Omit to create a normal DSH session in the Claude source project.' },
        limit: { type: 'integer', description: 'Page size, 1 to 100.' }, offset: { type: 'integer' },
        limitTurns: { type: 'integer', description: 'For sessions.resume, ask DSH to focus on the most recent N user turns when reading. For sessions.import, limit the archive to N turns.' },
        newSnapshot: { type: 'boolean', description: 'Only for sessions.import: create a separate archive copy.' },
      }, required: ['action'], additionalProperties: false },
      output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      isConcurrencySafe: (args) => !isCompatMutation(args.action),
      async execute(args, exec) {
        // Global Claude configuration and other projects' transcripts are outside a session workspace.
        {
          const policy = toolCtx.get('sandboxPolicy');
          if (!policy) throw new Error('The sandbox policy service is required for this operation.');
          const { approveEscalation } = await import('@deepseek-ai/dsh-sandbox');
          await approveEscalation({ requestedMode: 'danger-full-access',
            effectiveMode: policy.resolve(exec.agent ? { session: exec.agent.session } : {}).mode,
            subject: 'Claude Code compatibility operation',
            justification: `${args.action} accesses user-level Claude configuration or conversation history outside the session workspace.`,
          }, { approver: toolCtx.get('approval'), agent: exec.agent, callId: exec.callId,
            toolName: 'claude_compat', signal: exec.signal });
        }
        const cwd = args.cwd ?? (exec.agent ? toolCtx.get('workingDirectory')?.get(exec.agent.session) ?? exec.agent.session.header.cwd : undefined);
        return service.execute({ ...args, ...(cwd ? { cwd } : {}) }, exec.signal);
      },
    });
  });
  return service;
}
