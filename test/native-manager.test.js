import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCompatibilityService, registerCompatibilityService } from '../src/compat-service.js';
import { registerManagerCommands } from '../src/commands.js';
import { apply } from '../src/index.js';
import { writeDshSession } from '../scripts/cc-resume.mjs';
const signal = () => new AbortController().signal;

test('UI and direct operations preserve structured errors and invalidate only successful mutations', async () => {
  let invalidated = 0;
  const calls = [];
  const manager = createCompatibilityService({}, {}, () => invalidated++, {
    pluginOperation: async (request) => { calls.push(request); return { ok: request.target !== 'broken', action: request.action, error: 'network error' }; },
  });
  const failed = await manager.execute({ action: 'plugins.install', target: 'broken', cwd: '/project' });
  assert.equal(failed.ok, false); assert.equal(invalidated, 0);
  await manager.execute({ action: 'plugins.list', cwd: '/project' });
  assert.equal(invalidated, 0);
  const result = await manager.execute({ action: 'plugins.disable', target: 'plugin@market', cwd: '/project' });
  assert.equal(result.catalogRefreshed, true); assert.equal(invalidated, 1);
  assert.equal(calls[2].action, 'disable'); assert.equal(calls[2].cwd, '/project');
  await manager.dispose();
});

test('import links its returned durable session and retains partial-import warnings', async () => {
  const linked = [];
  const manager = createCompatibilityService({ workspaceRegistry: { create: async (cwd) => ({ attachSession: async (id) => linked.push([cwd, id]) }) } }, {}, () => {}, {
    sessionService: { importSession: async () => ({ sessionId: 'session-import', cwd: '/project', warnings: ['1 sidechain omitted'] }) },
  });
  const value = await manager.execute({ action: 'sessions.import', cwd: '/project', sessionId: 'abc' });
  assert.deepEqual(linked, [['/project', 'session-import']]);
  assert.deepEqual(value.warnings, ['1 sidechain omitted']);
  await manager.dispose();
});

test('background jobs accept different targets and support independent status and cancellation', async () => {
  let entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  const manager = createCompatibilityService({}, {}, () => {}, { pluginOperation: async (_request, { signal, onProgress }) => {
    onProgress({ phase: 'running', text: 'Downloading' }); entered();
    return await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  } });
  const job = await manager.call({ action: 'operation.start', request: { action: 'plugins.install', target: 'test@market' } });
  await ready;
  assert.equal(job.state, 'queued');
  assert.equal((await manager.call({ action: 'operation.status', id: job.id })).state, 'running');
  const other = await manager.call({ action: 'operation.start', request: { action: 'plugins.install', target: 'other@market' } });
  assert.notEqual(other.id, job.id);
  assert.equal((await manager.call({ action: 'operation.list' })).items.length, 2);
  const status = await manager.call({ action: 'operation.status', id: job.id });
  assert.match(status.progress, /Downloading/);
  const cancelled = await manager.call({ action: 'operation.cancel', id: job.id });
  assert.equal(cancelled.state, 'cancelled');
  assert.equal((await manager.call({ action: 'operation.status', id: job.id })).result.ok, false);
  assert.equal((await manager.call({ action: 'operation.status', id: other.id })).state, 'running');
  await manager.call({ action: 'operation.cancel', id: other.id });
  await manager.dispose();
});

test('native exact Fetch route validates the RPC envelope before dispatch', async () => {
  let route;
  const ctx = {
    effect() {},
    inject(names, callback) { if (names.includes('connection')) callback({ connection: { fetch: { register: (value) => { route = value; } } } }); },
  };
  const manager = registerCompatibilityService(ctx, {}, () => {});
  assert.equal(route.path, '/api/claude-compat');
  assert.deepEqual(route.methods, ['POST']);
  const response = await route.fetch(new Request('http://fixture/api/claude-compat', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'bad-method', method: 'different', payload: { action: 'status' } }) }));
  const result = await response.json();
  assert.equal(result.rpcId, 'bad-method'); assert.equal(result.result.ok, false);
  assert.equal(result.result.error.code, 'gateway/bad-request');
  await manager.dispose();
});

test('slash commands return native views without calling a model or writing history', async () => {
  const defs = new Map(); let called = 0;
  const ctx = { inject: (_names, callback) => callback({ commands: { register: (definition) => defs.set(definition.name, definition) } }) };
  registerManagerCommands(ctx, {}, () => undefined, { execute: async () => { called++; throw new Error('should not execute'); } });
  const agent = { session: { header: { cwd: '/project with spaces' } }, steer: () => { throw new Error('model must not run'); } };
  for (const [name, mode] of [['cc-resume', 'sessions'], ['cc-plugin', 'plugins']]) {
    const result = await defs.get(name).handler({ agent, rawInput: '', signal: signal() });
    assert.deepEqual(JSON.parse(result.text), { ui: 'claude-compat', cwd: '/project with spaces', mode });
  }
  assert.equal(called, 0);
});

test('slash mutation forwards cwd and cancellation and reports business failure as error', async () => {
  const defs = new Map(); const requests = [];
  const ctx = { inject: (_names, callback) => callback({ commands: { register: (definition) => defs.set(definition.name, definition) } }) };
  registerManagerCommands(ctx, {}, () => undefined, { execute: async (request, passedSignal) => { requests.push([request, passedSignal]); return { ok: false, error: 'authentication failed' }; } });
  const abort = signal();
  const result = await defs.get('cc-plugin').handler({ agent: { session: { header: { cwd: '/project' } } }, rawInput: 'install test@market', signal: abort });
  assert.equal(result.kind, 'error'); assert.match(result.text, /authentication failed/);
  assert.deepEqual(requests[0], [{ action: 'plugins.install', cwd: '/project', target: 'test@market' }, abort]);
});

test('unloading aborts and drains direct calls, including a resolved cancellation result', async () => {
  let entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  let received;
  const manager = createCompatibilityService({}, {}, () => {}, { pluginOperation: async (_request, { signal }) => {
    received = signal; entered();
    return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ ok: false, error: 'cancelled' }), { once: true }));
  } });
  const running = manager.execute({ action: 'plugins.install', target: 'plugin@market' }, signal());
  await ready;
  const active = await manager.call({ action: 'operation.active' });
  assert.equal(active.state, 'queued', 'commands and tools share UI jobs; this adapter has not emitted running yet');
  await manager.dispose();
  assert.equal(received.aborted, true);
  assert.equal((await running).ok, false);
});

test('resolved failed CLI cancellation is classified as cancelled', async () => {
  const manager = createCompatibilityService({}, {}, () => {}, { pluginOperation: async (_request, { signal }) =>
    new Promise((resolve) => signal.addEventListener('abort', () => resolve({ ok: false, error: 'cancelled' }), { once: true })) });
  const job = await manager.call({ action: 'operation.start', request: { action: 'plugins.install', target: 'plugin@market' } });
  assert.equal((await manager.call({ action: 'operation.cancel', id: job.id })).state, 'cancelled');
  await manager.dispose();
});

test('an unconfirmed CLI cleanup never reports successful cancellation', async () => {
  const manager = createCompatibilityService({}, {}, () => {}, { pluginOperation: async (_request, { signal }) =>
    new Promise((resolve) => signal.addEventListener('abort', () => resolve({ ok: false, unknown: true, error: 'process tree outcome unknown' }), { once: true })) });
  const job = await manager.call({ action: 'operation.start', request: { action: 'plugins.install', target: 'plugin@market' } });
  const result = await manager.call({ action: 'operation.cancel', id: job.id });
  assert.equal(result.state, 'failed'); assert.equal(result.result.unknown, true);
  await manager.dispose();
});

test('plugin pagination is applied above the strict plugin adapter', async () => {
  const manager = createCompatibilityService({}, {}, () => {}, { pluginOperation: async (request) => {
    assert.equal('limit' in request, false); assert.equal('offset' in request, false);
    return { ok: true, items: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] };
  } });
  const result = await manager.execute({ action: 'plugins.list', limit: 1, offset: 1 });
  assert.deepEqual(result.items, [{ name: 'b' }]); assert.equal(result.total, 3); assert.equal(result.hasMore, true);
  await manager.dispose();
});

test('management remains registered when only skill discovery is disabled', () => {
  const defs = new Map(); let wired = false;
  const ctx = { skills: { registerProvider: () => { throw new Error('skills disabled'); } }, effect() {},
    inject(names, callback) {
      if (names.includes('commands')) callback({ commands: { register: (definition) => defs.set(definition.name, definition) } });
      if (names.includes('connection')) callback({ connection: { fetch: { register: () => { wired = true; } } } });
    },
  };
  apply(ctx, { enableSkills: false, enableRules: false, enableHooks: false, enableMcp: false, enableStarNudge: false });
  assert.equal(wired, true); assert.equal(defs.size, 5);
});

test('native tool registration and full-access execution use the actual DSH registry', async () => {
  const { Context } = await import('@deepseek-ai/cordis');
  const tools = await import('@deepseek-ai/dsh-tools');
  const prompt = await import('@deepseek-ai/dsh-system-prompt');
  const ctx = new Context();
  await ctx.plugin(prompt.default, {});
  await ctx.plugin(tools.default);
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'danger-full-access' }) });
  await ctx.plugin((scope) => { registerCompatibilityService(scope, {}, () => {}); });
  const definition = ctx.tools.get('claude_compat');
  assert.ok(definition);
  const result = await definition.execute({ action: 'status' }, { signal: signal() });
  assert.equal(result.ok, true); assert.match(result.version, /^1\.2\./);
  await ctx.fiber.dispose();
});

test('legacy writer never overwrites continued DSH messages', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dcc-preserve-'));
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'session.jsonl.zstd');
  await writeFile(path, 'existing DSH continuation');
  assert.equal(writeDshSession(dir, 'existing', '/project', []), path);
  assert.equal(await readFile(path, 'utf8'), 'existing DSH continuation');
});
