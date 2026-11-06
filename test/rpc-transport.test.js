// Exercise the native Client HTTP envelope against the native Host router.
// The Gateway already owns /api; testing service.execute alone cannot catch a route collision.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection';
import { installConnection } from '@deepseek-ai/dsh-client-connection/client';
import { registerCompatibilityService } from '../src/compat-service.js';
import { claudeProjectsDir } from '../src/lib.js';

async function fixture(t, services = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dcc-rpc-'));
  const userClaudeDir = join(root, 'claude');
  const cwd = join(root, 'project');
  const projectDir = claudeProjectsDir(cwd, userClaudeDir);
  await mkdir(cwd, { recursive: true });
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, 'fixture-history.jsonl'), JSON.stringify({ type: 'user', cwd,
    timestamp: '2026-11-06T03:00:00.000Z', message: { content: 'Transport fixture conversation' } }) + '\n');
  const ctx = new Context();
  const client = new Context();
  const routes = new Map();
  ctx.provide('webServer', {
    host: '127.0.0.1', protocol: 'http:',
    register(route) { routes.set(route.path, route); return () => routes.delete(route.path); },
  });
  new HostConnectionService(ctx, [], {
    isAuthenticated: (request) => request.headers.cookie === 'dcc-fixture=allowed',
    authenticateApi: () => undefined,
  });
  const host = ctx.get('connection');
  // Reserve the same singleton interceptor that DSH Gateway installs in production.
  host.rpc.intercept('/api', (endpoint) => endpoint === 'probe', async () => ({ ok: true, value: 'original-gateway' }));
  const gateway = host.createSharedFetchHandler('/api');
  let invalidated = 0;
  for (const [name, service] of Object.entries(services)) ctx.provide(name, service);
  let plugin;
  await ctx.plugin((scope) => {
    plugin = scope;
    registerCompatibilityService(scope, { userClaudeDir }, () => invalidated++);
  });
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://fixture').pathname;
    // Desktop forwards /api to Connection's Fetch handler; other paths are
    // resource reads and reject POST even if a Web-only handler was registered.
    if (!pathname.startsWith('/api/')) { response.writeHead(405, { allow: 'GET, HEAD' }); response.end(); return; }
    const admission = host.admit(request);
    if ('rejection' in admission) { response.writeHead(admission.rejection); response.end('refused'); return; }
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const result = await gateway.fetch(new Request('http://fixture' + request.url, {
        method: request.method,
        headers: Object.fromEntries(Object.entries(request.headers).filter(([, value]) => typeof value === 'string')),
        body: Buffer.concat(chunks),
      }), admission.peer);
      response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) { response.writeHead(500); response.end(error.message); }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const requests = [];
  installConnection(client, { interactions: 'none', transport: {
    fetch: (input, init) => {
      requests.push(String(input));
      return fetch(new URL(input, base), { ...init, headers: { ...init.headers, cookie: 'dcc-fixture=allowed' } });
    },
  } });
  // Feed the actual browser artifact's declared channel/endpoint through native Client RPC.
  const browserSource = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
  const binding = /ctx\.connection\.rpc\.call\('([^']+)',\s*'([^']+)'/.exec(browserSource);
  assert.ok(binding, 'the browser RPC binding must remain discoverable by this contract test');
  const [, channel, endpoint] = binding;
  const call = (payload) => client.get('connection').rpc.call(channel, endpoint, payload, AbortSignal.timeout(3000));
  t.after(async () => {
    await client.fiber.dispose();
    await ctx.fiber.dispose();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('dcc-rpc-'));
    await rm(root, { recursive: true, force: true });
  });
  return { host, gateway, routes, plugin, base, path: `${channel}/${endpoint}`, call, requests, cwd, invalidated: () => invalidated };
}

test('browser requests reach native compatibility RPC while the Gateway owns /api', async (t) => {
  const f = await fixture(t);
  const status = await f.call({ action: 'status' });
  assert.equal(status.ok, true, status.error?.message);
  assert.equal(status.value.ok, true);
  assert.deepEqual(status.value.transport, { path: '/api/claude-compat', httpStatus: 200, ready: true });
  assert.match(status.value.version, /^1\.2\./);
  assert.equal(new URL(f.requests[0], f.base).pathname, f.path);

  const plugins = await f.call({ action: 'plugins.list', cwd: f.cwd, query: '', limit: 20 });
  assert.equal(plugins.ok, true, plugins.error?.message);
  assert.deepEqual(plugins.value.items, []);
  const sessions = await f.call({ action: 'sessions.list', cwd: f.cwd, limit: 20 });
  assert.equal(sessions.ok, true, sessions.error?.message);
  assert.equal(sessions.value.items[0].id, 'fixture-history');
  const preview = await f.call({ action: 'sessions.preview', cwd: f.cwd, sessionId: 'fixture-history' });
  assert.equal(preview.ok, true, preview.error?.message);
  assert.match(preview.value.text, /Transport fixture/);
  const active = await f.call({ action: 'operation.active' });
  assert.deepEqual(active, { ok: true, value: null });

  const original = await f.gateway.fetch(new Request(`${f.base}/api/probe`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'gateway-probe', method: 'probe', payload: {} }),
  }), f.host.browserPeer);
  assert.equal(original.status, 200);
  assert.equal((await original.json()).result.value, 'original-gateway');
});

test('native compatibility channel retains authentication and Origin checks', async (t) => {
  const f = await fixture(t);
  const body = JSON.stringify({ type: 'client-request', rpcId: 'auth-probe', method: f.path.split('/').at(-1), payload: { action: 'status' } });
  const unauthorized = await fetch(f.base + f.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.equal(unauthorized.status, 401);
  const crossOrigin = await fetch(f.base + f.path, { method: 'POST', headers: {
    'content-type': 'application/json', cookie: 'dcc-fixture=allowed', origin: 'https://outside.invalid',
  }, body });
  assert.equal(crossOrigin.status, 403);
  const nonOwner = await f.gateway.fetch(new Request(f.base + f.path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  }), { principal: { kind: 'viewer' } });
  assert.equal(nonOwner.status, 403);
  const failed = await f.call({ action: 'unknown-action' });
  assert.equal(failed.ok, false);
  assert.match(failed.error.message, /Unknown Claude compatibility action/);
  assert.equal(f.invalidated(), 0);
});

test('native HTTP returns independent task receipts and a recoverable queue snapshot', async (t) => {
  const f = await fixture(t);
  const reloadId = randomUUID(), statusId = randomUUID();
  const [reload, status] = await Promise.all([
    f.call({ action: 'operation.start', id: reloadId, request: { action: 'reload' } }),
    f.call({ action: 'operation.start', id: statusId, request: { action: 'status' } }),
  ]);
  assert.equal(reload.ok, true); assert.equal(status.ok, true);
  assert.equal(reload.value.id, reloadId); assert.equal(status.value.id, statusId);
  assert.notEqual(reload.value.key, status.value.key);
  const snapshot = await f.call({ action: 'operation.list' });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.value.generation, reload.value.generation);
  assert.deepEqual(new Set(snapshot.value.items.map((job) => job.id)), new Set([reloadId, statusId]));
  const repeated = await f.call({ action: 'operation.start', id: reloadId, request: { action: 'reload' } });
  assert.equal(repeated.value.id, reloadId);
  assert.equal(f.invalidated(), 1, 'replaying the same receipt does not execute reload again');
});

test('native HTTP handoff preserves explicit current target and creates fresh sessions only in the Claude source workspace', async (t) => {
  const workspaces = [], creates = [], prompts = [];
  const f = await fixture(t, {
    workspaceRegistry: { create: async (path) => { workspaces.push(path); return { id: 'http-source-workspace', path }; } },
    sessionController: {
      create: async (request) => { creates.push(structuredClone(request)); return { sessionId: 'http-fresh-dsh' }; },
      prompt: async (request) => { prompts.push(structuredClone(request)); return { accepted: true }; },
    },
  });
  async function submit(id, request) {
    const accepted = await f.call({ action: 'operation.start', id, request });
    assert.equal(accepted.ok, true, accepted.error?.message);
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await f.call({ action: 'operation.status', id });
      assert.equal(response.ok, true, response.error?.message);
      if (!['running', 'queued'].includes(response.value.state)) return response.value;
    }
    throw new Error('HTTP handoff fixture did not settle');
  }
  const currentId = randomUUID();
  const source = { action: 'sessions.resume', cwd: f.cwd, sessionId: 'fixture-history' };
  const current = await submit(currentId, { ...source, targetSessionId: 'http-current-dsh' });
  assert.equal(current.state, 'done', current.result?.error);
  assert.equal(current.targetSessionId, 'http-current-dsh');
  assert.equal(current.result.sessionId, 'http-current-dsh');
  assert.equal(current.result.sourceCwd, f.cwd);
  assert.equal(current.result.destination, 'current');
  assert.deepEqual(workspaces, []); assert.deepEqual(creates, []);
  assert.equal(prompts[0].requestId, currentId);
  assert.equal(prompts[0].sessionId, 'http-current-dsh');
  const readingRequest = prompts[0].content[0].text;
  assert.ok(readingRequest.includes(JSON.stringify(current.result.sourcePath)));
  assert.ok(readingRequest.includes(JSON.stringify(f.cwd)));
  assert.match(readingRequest, /背景、当前任务状态和下一步计划/);
  assert.equal(readingRequest.includes('Transport fixture conversation'), false, 'HTTP handoff carries a reference, never JSONL body');
  assert.doesNotMatch(readingRequest, /继续处理明确的待办|请接手并继续/);
  assert.ok(readingRequest.length < 1024);
  const replay = await f.call({ action: 'operation.start', id: currentId, request: { ...source, targetSessionId: 'http-current-dsh' } });
  assert.equal(replay.value.state, 'done'); assert.equal(prompts.length, 1);

  const freshId = randomUUID(), fresh = await submit(freshId, source);
  assert.equal(fresh.state, 'done', fresh.result?.error);
  assert.equal(fresh.result.destination, 'new'); assert.equal(fresh.result.sessionId, 'http-fresh-dsh');
  assert.deepEqual(workspaces, [f.cwd]);
  assert.deepEqual(creates, [{ workspaceId: 'http-source-workspace' }]);
  assert.equal(prompts[1].requestId, freshId); assert.equal(prompts[1].sessionId, 'http-fresh-dsh');
  assert.equal(prompts[1].content[0].text, readingRequest, 'entry routing changes only the target, not the reference-only reading request');
  assert.equal((await f.call({ action: 'status' })).value.contextHandoff, true);

  const refused = await f.gateway.fetch(new Request(f.base + f.path, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'viewer-handoff', method: 'claude-compat', payload: { ...source, targetSessionId: 'http-current-dsh' } }),
  }), { principal: { kind: 'viewer' } });
  assert.equal(refused.status, 403);
  assert.equal(prompts.length, 2, 'non-owner refusal occurs before any native admission');
});

test('unloading removes the compatibility HTTP route without removing the Gateway', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call({ action: 'status' })).ok, true);
  await f.plugin.fiber.dispose();
  await assert.rejects(f.call({ action: 'status' }), /HTTP 404/);
  const response = await f.gateway.fetch(new Request(`${f.base}/api/probe`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'still-live', method: 'probe', payload: {} }),
  }), f.host.browserPeer);
  assert.equal((await response.json()).result.value, 'original-gateway');
});
