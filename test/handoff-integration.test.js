// Exercise the real compatibility/command adapters without creating native sessions or calling a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import { createCompatibilityService } from '../src/compat-service.js';
import { registerManagerCommands } from '../src/commands.js';

const SOURCE = Object.freeze({
  id: 'claude-history-fixture', cwd: '/fixtures/Claude original project',
  sourcePath: '/fixtures/Claude history/claude-history-fixture.jsonl',
  title: 'Fixture history', sizeBytes: 4096, warnings: ['fixture warning'],
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
async function settled(manager, id) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const receipt = await manager.call({ action: 'operation.status', id });
    if (!['running', 'queued'].includes(receipt.state)) return receipt;
    await tick();
  }
  throw new Error('Controlled handoff did not settle');
}
function fixture(t, options = {}) {
  const ctx = new Context();
  const calls = { prepare: [], workspaces: [], creates: [], prompts: [], attaches: [], archives: [], stops: [] };
  const entered = deferred();
  ctx.provide('workingDirectory', { get: () => '/fixtures/current DSH directory' });
  ctx.provide('workspaceRegistry', { create: async (path) => {
    calls.workspaces.push(path);
    return { id: 'workspace-source', path: '/fixtures/canonical source',
      attachSession: async (id) => { calls.attaches.push(id); } };
  } });
  ctx.provide('sessionController', {
    create: async (request) => {
      calls.creates.push(structuredClone(request));
      if (options.create) return options.create(request);
      return { sessionId: `ordinary-dsh-${calls.creates.length}` };
    },
    prompt: async (request, signal) => {
      calls.prompts.push({ request: structuredClone(request), signal });
      entered.resolve();
      if (options.prompt) return options.prompt(request, signal);
      return { accepted: true };
    },
    cancel: (request) => { calls.stops.push(request); throw new Error('Handoff must never stop the native Agent'); },
  });
  const manager = createCompatibilityService(ctx, {}, () => {}, { sessionService: {
    prepareHandoff: async (request, signal) => {
      calls.prepare.push({ request: structuredClone(request), signal });
      return Object.defineProperty({ ...SOURCE, warnings: [...SOURCE.warnings] }, 'text', {
        get() { throw new Error('handoff adapters must not inspect the transcript body'); },
      });
    },
    importSession: async (request) => {
      calls.archives.push(structuredClone(request));
      return { sessionId: 'legacy-archive', cwd: request.cwd, imported: true };
    },
  } });
  t.after(async () => { options.release?.(); await manager.dispose(); await ctx.fiber.dispose(); });
  const request = (extra = {}) => ({ action: 'sessions.resume', cwd: '/fixtures/profile manager directory', sessionId: SOURCE.id, ...extra });
  return { ctx, manager, calls, entered: entered.promise, request };
}

test('new handoff uses prepared Claude cwd and native ordinary create, with job UUID as prompt requestId', async (t) => {
  const f = fixture(t), id = randomUUID();
  const submitted = await f.manager.call({ action: 'operation.start', id, request: f.request() });
  const receipt = await settled(f.manager, submitted.id);
  assert.equal(receipt.state, 'done');
  assert.equal(receipt.result.accepted, true);
  assert.equal(receipt.result.destination, 'new');
  assert.equal(receipt.result.sourceCwd, SOURCE.cwd);
  assert.equal(receipt.result.sessionId, 'ordinary-dsh-1');
  assert.equal(receipt.result.workspaceId, 'workspace-source');
  assert.deepEqual(f.calls.workspaces, [SOURCE.cwd], 'manager/profile cwd is not the source workspace');
  assert.deepEqual(f.calls.creates, [{ workspaceId: 'workspace-source' }], 'native Controller owns ordinary preset/model and workspace attachment');
  assert.deepEqual(f.calls.attaches, [], 'new handoff must not manually attach an imported archive');
  assert.equal(f.calls.archives.length, 0);
  assert.equal(f.calls.prompts.length, 1);
  const prompt = f.calls.prompts[0].request;
  assert.equal(prompt.requestId, id);
  assert.equal(prompt.sessionId, 'ordinary-dsh-1');
  assert.equal(prompt.mode, 'queue');
  assert.deepEqual(prompt.content.map((part) => part.type), ['text']);
  const text = prompt.content[0].text;
  assert.ok(text.includes(JSON.stringify(SOURCE.sourcePath)));
  assert.ok(text.includes(JSON.stringify(SOURCE.cwd)));
  assert.match(text, /背景、当前任务状态和下一步计划/);
  assert.doesNotMatch(text, /User goal:|Assistant state:|继续处理明确的待办|请接手并继续/);
  assert.ok(text.length < 1024);
});

test('current handoff only queues to the explicit DSH target, without migrating either workspace', async (t) => {
  const f = fixture(t), id = randomUUID();
  const request = f.request({ targetSessionId: 'current-dsh-session' });
  const submitted = await f.manager.call({ action: 'operation.start', id, request });
  const receipt = await settled(f.manager, submitted.id);
  assert.equal(receipt.state, 'done');
  assert.equal(receipt.targetSessionId, 'current-dsh-session');
  assert.equal(receipt.result.destination, 'current');
  assert.equal(receipt.result.sessionId, 'current-dsh-session');
  assert.equal(receipt.result.sourceCwd, SOURCE.cwd);
  assert.equal(receipt.result.workspaceId, undefined);
  assert.deepEqual(f.calls.workspaces, []);
  assert.deepEqual(f.calls.creates, []);
  assert.deepEqual(f.calls.attaches, []);
  assert.equal(f.calls.archives.length, 0);
  assert.equal(f.calls.prompts[0].request.sessionId, 'current-dsh-session');
  assert.equal(f.calls.prompts[0].request.requestId, id);
  assert.equal(f.calls.prompts[0].request.mode, 'queue');
});

test('replaying an operation UUID during or after admission never creates or prompts twice', async (t) => {
  const gate = deferred();
  const f = fixture(t, { prompt: () => gate.promise, release: () => gate.resolve({ accepted: true }) }), id = randomUUID();
  const request = f.request();
  const first = await f.manager.call({ action: 'operation.start', id, request });
  await f.entered;
  const duplicate = await f.manager.call({ action: 'operation.start', id, request: { ...request } });
  assert.equal(duplicate.id, first.id);
  assert.equal(f.calls.creates.length, 1); assert.equal(f.calls.prompts.length, 1);
  gate.resolve({ accepted: true });
  assert.equal((await settled(f.manager, id)).state, 'done');
  const completed = await f.manager.call({ action: 'operation.start', id, request });
  assert.equal(completed.state, 'done');
  assert.equal(completed.result.accepted, true);
  assert.equal(f.calls.prepare.length, 1); assert.equal(f.calls.workspaces.length, 1);
  assert.equal(f.calls.creates.length, 1); assert.equal(f.calls.prompts.length, 1);
});

test('native admission acknowledged while job cancellation races remains done and never stops the target', async (t) => {
  const gate = deferred();
  const f = fixture(t, { prompt: () => gate.promise, release: () => gate.resolve({ accepted: true }) }), id = randomUUID();
  await f.manager.call({ action: 'operation.start', id, request: f.request({ targetSessionId: 'running-dsh-session' }) });
  await f.entered;
  const cancellation = f.manager.call({ action: 'operation.cancel', id });
  assert.equal(f.calls.prompts[0].signal.aborted, true);
  gate.resolve({ accepted: true });
  const receipt = await cancellation;
  assert.equal(receipt.state, 'done');
  assert.equal(receipt.result.ok, true); assert.equal(receipt.result.accepted, true);
  assert.equal(receipt.result.sessionId, 'running-dsh-session');
  assert.deepEqual(f.calls.stops, []);
});

test('status distinguishes the native context handoff capability from legacy persistence', async (t) => {
  const f = fixture(t);
  const status = await f.manager.execute({ action: 'status' });
  assert.equal(status.contextHandoff, true);
  assert.equal(status.nativeSessions, false);
});

test('create failure preserves native partial session identity and never falls back to the current session', async (t) => {
  const failure = Object.assign(new Error('created but workspace attachment failed'), {
    code: 'session/workspace-attach-failed', details: { sessionId: 'native-partial-session', workspaceId: 'workspace-source' },
  });
  const f = fixture(t, { create: () => { throw failure; } });
  const id = randomUUID();
  await f.manager.call({ action: 'operation.start', id, request: f.request() });
  const receipt = await settled(f.manager, id);
  assert.equal(receipt.state, 'failed');
  assert.equal(receipt.result.ok, false); assert.equal(receipt.result.accepted, false);
  assert.equal(receipt.result.partial, true);
  assert.equal(receipt.result.workspaceId, 'workspace-source');
  assert.equal(receipt.result.sessionId, 'native-partial-session');
  assert.equal(f.calls.creates.length, 1); assert.equal(f.calls.prompts.length, 0);
});

async function commands(t, options) {
  const f = fixture(t, options), definitions = new Map();
  f.ctx.provide('commands', { register: (definition) => definitions.set(definition.name, definition) });
  await f.ctx.plugin((scope) => registerManagerCommands(scope, {}, () => undefined, f.manager));
  await tick();
  assert.ok(definitions.has('cc-resume'));
  const agent = { id: 'command-current-dsh', session: { id: 'command-current-dsh', header: { cwd: '/fixtures/old DSH header cwd' } } };
  const invoke = (rawInput, receivingAgent = agent) => definitions.get('cc-resume').handler({ agent: receivingAgent, rawInput, signal: new AbortController().signal });
  return { ...f, agent, invoke };
}

test('cc-resume resume and import alias both hand off into the exact command Agent with source overrides', async (t) => {
  const f = await commands(t);
  for (const verb of ['resume', 'import']) {
    const outcome = await f.invoke(`${verb} ${SOURCE.id} --cwd "/fixtures/selected Claude source" --limit-turns 50`);
    assert.equal(outcome.kind, 'success');
    const value = JSON.parse(outcome.text);
    assert.equal(value.destination, 'current'); assert.equal(value.sessionId, f.agent.id);
    const prepared = f.calls.prepare.at(-1).request;
    assert.equal(prepared.cwd, '/fixtures/selected Claude source');
    assert.equal(prepared.sessionId, SOURCE.id); assert.equal(prepared.targetSessionId, f.agent.id);
    assert.equal(prepared.limitTurns, 50);
  }
  assert.equal(f.calls.prompts.length, 2);
  assert.ok(f.calls.prompts.every(({ request }) => request.sessionId === f.agent.id));
  assert.deepEqual(f.calls.creates, []); assert.deepEqual(f.calls.workspaces, []); assert.deepEqual(f.calls.archives, []);
});

test('cc-resume browser payload pins the receiving DSH target, including pick and session-id fallback', async (t) => {
  const f = await commands(t);
  for (const input of ['', 'pick']) {
    const outcome = await f.invoke(input);
    assert.deepEqual(JSON.parse(outcome.text), { ui: 'claude-compat', mode: 'sessions', cwd: '/fixtures/current DSH directory', targetSessionId: f.agent.id });
  }
  const fallback = await f.invoke('', { session: { id: 'session-id-only', header: { cwd: '/fixtures/header' } } });
  assert.equal(JSON.parse(fallback.text).targetSessionId, 'session-id-only');
  assert.equal(f.calls.prepare.length, 0); assert.equal(f.calls.prompts.length, 0);
});

test('cc-resume archive keeps the explicit legacy import parameters and does not prompt a DSH target', async (t) => {
  const f = await commands(t);
  const outcome = await f.invoke(`archive ${SOURCE.id} --cwd "/fixtures/archive source" --limit-turns 200 --new-snapshot`);
  assert.equal(outcome.kind, 'success');
  assert.equal(JSON.parse(outcome.text).sessionId, 'legacy-archive');
  assert.deepEqual(f.calls.archives, [{ action: 'sessions.import', cwd: '/fixtures/archive source', sessionId: SOURCE.id, limitTurns: 200, newSnapshot: true }]);
  assert.deepEqual(f.calls.prompts, []); assert.deepEqual(f.calls.creates, []); assert.deepEqual(f.calls.prepare, []);
});
