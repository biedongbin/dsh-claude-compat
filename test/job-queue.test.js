import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createCompatibilityService, operationKey } from '../src/compat-service.js';
import { runPluginOperation } from '../src/plugin-manager.js';

const turn = () => new Promise((done) => setImmediate(done));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const update = (target, extra = {}) => ({ action: 'plugins.marketplace-update', target, ...extra });
const start = (manager, request, id) => manager.call({ action: 'operation.start', request, ...(id ? { id } : {}) });
async function status(manager, id) { await turn(); return manager.call({ action: 'operation.status', id }); }
function controlled(t, extra = {}) {
  const entries = new Map();
  const manager = createCompatibilityService({}, {}, () => {}, {
    ...extra,
    pluginOperation: async (request, { signal, onProgress }) => {
      const outcome = deferred();
      const entry = { request, signal, progress: onProgress, ...outcome };
      entries.set(request.target, entry);
      const abort = () => outcome.reject(signal.reason ?? new Error('cancelled'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      try { return await outcome.promise; }
      finally { signal.removeEventListener('abort', abort); }
    },
  });
  t.after(() => manager.dispose());
  return { manager, entries };
}

async function realLockFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dcc-queue-'));
  const userClaudeDir = join(root, 'claude');
  const pluginsRoot = join(root, 'cache');
  await mkdir(userClaudeDir); await mkdir(pluginsRoot);
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('dcc-queue-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const entries = new Map(), started = [];
  let active = 0, maxActive = 0;
  const manager = createCompatibilityService({}, { userClaudeDir, pluginsRoot }, () => {}, {
    pluginOperation: (request, deps) => runPluginOperation(request, { ...deps, claude: async (args, _timeout, { signal }) => {
      const target = args[2];
      started.push(target); active += 1; maxActive = Math.max(maxActive, active);
      const outcome = deferred();
      entries.set(target, { ...outcome, signal });
      const abort = () => outcome.reject(new Error('fake CLI cancelled'));
      signal.addEventListener('abort', abort, { once: true });
      try { return await outcome.promise; }
      finally { signal.removeEventListener('abort', abort); active -= 1; }
    } }),
    sessionService: {
      importSession: async ({ sessionId, cwd }) => ({ sessionId: `import-${sessionId}`, cwd, imported: true }),
      listSessions: async ({ cwd }) => ({ items: [{ id: 'read', cwd }] }),
    },
  });
  t.after(() => manager.dispose());
  return { manager, entries, started, cwd: root, maxActive: () => maxActive };
}

test('operation keys isolate marketplace, plugin and session targets', () => {
  assert.equal(operationKey(update('market')), JSON.stringify(['marketplace', 'market']));
  assert.equal(operationKey({ action: 'plugins.marketplace-update' }), JSON.stringify(['marketplace', '*']));
  assert.equal(operationKey({ action: 'plugins.install', target: 'plugin@market' }), JSON.stringify(['plugin', 'plugin@market']));
  assert.equal(operationKey({ action: 'plugins.list' }), JSON.stringify(['plugin', '*']));
  assert.equal(operationKey({ action: 'sessions.import', cwd: '/project', sessionId: 'id' }), JSON.stringify(['session', '/project', 'id']));
  assert.equal(operationKey({ action: 'sessions.import' }), JSON.stringify(['session', '', '']));
  assert.equal(operationKey({ action: 'reload' }), JSON.stringify(['reload']));
});

test('different targets are accepted together and progress/results remain isolated', async (t) => {
  const { manager, entries } = controlled(t);
  const first = await start(manager, update('first'));
  const second = await start(manager, update('second'));
  assert.equal(first.state, 'queued'); assert.equal(second.state, 'queued');
  assert.notEqual(first.id, second.id); assert.notEqual(first.key, second.key);
  assert.equal(first.generation, second.generation);
  assert.ok(second.revision > first.revision);
  entries.get('first').progress({ phase: 'running' });
  entries.get('first').progress({ phase: 'output', text: 'first log' });
  entries.get('second').progress({ phase: 'outputs', text: 'second log' });
  const one = await status(manager, first.id), two = await status(manager, second.id);
  assert.equal(one.state, 'running'); assert.equal(two.state, 'running');
  assert.match(one.progress, /first log/); assert.doesNotMatch(one.progress, /second log/);
  assert.match(two.progress, /second log/); assert.doesNotMatch(two.progress, /first log/);
  entries.get('first').resolve({ ok: true, text: 'first result' });
  entries.get('second').resolve({ ok: false, error: 'second failure' });
  assert.equal((await status(manager, first.id)).state, 'done');
  assert.equal((await status(manager, second.id)).state, 'failed');
  assert.equal((await status(manager, first.id)).result.text, 'first result');
  const third = await start(manager, update('third'));
  entries.get('third').resolve({ ok: true, text: 'after failure' });
  assert.equal((await status(manager, third.id)).state, 'done');
});

test('same in-flight request is idempotent while conflicting item operations reject', async (t) => {
  const { manager, entries } = controlled(t);
  const first = await start(manager, update('same', { cwd: '/project' }));
  const duplicate = await start(manager, { cwd: '/project', target: 'same', action: 'plugins.marketplace-update' });
  assert.equal(duplicate.id, first.id); assert.equal(duplicate.revision, first.revision);
  assert.equal(entries.size, 1);
  await assert.rejects(start(manager, { action: 'plugins.marketplace-remove', target: 'same', cwd: '/project' }), /different operation for this item/);
  await assert.rejects(start(manager, update('same', { cwd: '/different' })), /different operation for this item/);
  entries.get('same').resolve({ ok: true });
  assert.equal((await status(manager, first.id)).state, 'done');
  const repeat = await start(manager, update('same', { cwd: '/project' }));
  assert.notEqual(repeat.id, first.id, 'an explicit new update is allowed after completion');
});

test('client UUIDs and duplicate aliases recover the same active or completed receipt', async (t) => {
  const { manager, entries } = controlled(t);
  const id = randomUUID(), alias = randomUUID();
  const first = await start(manager, update('receipt'), id);
  assert.equal(first.id, id);
  assert.equal((await start(manager, update('receipt'), id)).id, id);
  assert.equal((await start(manager, update('receipt'), alias)).id, id);
  await assert.rejects(start(manager, update('different'), id), /id already belongs/);
  entries.get('receipt').resolve({ ok: true, text: 'saved' });
  await status(manager, id);
  assert.equal((await start(manager, update('receipt'), id)).result.text, 'saved');
  assert.equal((await start(manager, update('receipt'), alias)).id, id);
  assert.equal(entries.size, 1);
  await assert.rejects(start(manager, update('receipt', { cwd: '/changed' }), alias), /id already belongs/);
  await assert.rejects(start(manager, update('invalid'), 'not-a-uuid'), /must be a UUID/);
});

test('caller mutation cannot alter the accepted request snapshot or item key', async (t) => {
  const { manager, entries } = controlled(t);
  const request = update('original', { cwd: '/original' });
  const job = await start(manager, request);
  request.target = 'changed'; request.cwd = '/changed'; request.action = 'plugins.marketplace-remove';
  const view = await status(manager, job.id);
  assert.equal(view.action, 'plugins.marketplace-update'); assert.equal(view.target, 'original'); assert.equal(view.cwd, '/original');
  assert.equal(view.key, JSON.stringify(['marketplace', 'original']));
  assert.equal(entries.get('original').request.target, 'original');
  assert.equal((await start(manager, update('original', { cwd: '/original' }))).id, job.id);
});

test('real canonical writer lock queues other targets; queued cancellation never kills the owner', async (t) => {
  const f = await realLockFixture(t);
  const first = await start(f.manager, update('first', { cwd: f.cwd }));
  await turn();
  assert.deepEqual(f.started, ['first']);
  assert.equal((await status(f.manager, first.id)).state, 'running');
  const queued = await start(f.manager, update('cancel-me', { cwd: f.cwd }));
  const third = await start(f.manager, update('third', { cwd: f.cwd }));
  assert.equal(queued.state, 'queued'); assert.equal(third.state, 'queued');
  const cancelled = await f.manager.call({ action: 'operation.cancel', id: queued.id });
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(f.entries.get('first').signal.aborted, false);
  assert.deepEqual(f.started, ['first']);
  const imported = await f.manager.execute({ action: 'sessions.import', cwd: f.cwd, sessionId: 'independent' });
  assert.equal(imported.sessionId, 'import-independent');
  const read = await f.manager.execute({ action: 'sessions.list', cwd: f.cwd });
  assert.equal(read.items[0].id, 'read');
  assert.deepEqual(f.started, ['first'], 'independent reads/imports complete while the CLI write is held');
  f.entries.get('first').resolve({ ok: true, stdout: 'first saved' });
  await turn();
  assert.deepEqual(f.started, ['first', 'third']);
  assert.equal((await status(f.manager, third.id)).state, 'running');
  f.entries.get('third').resolve({ ok: true, stdout: 'third saved' });
  assert.equal((await status(f.manager, first.id)).state, 'done');
  assert.equal((await status(f.manager, third.id)).state, 'done');
  assert.equal(f.maxActive(), 1, 'the existing writer lock still serializes shared configuration writes');
});

test('a failed real-lock holder releases its successor without poisoning the queue', async (t) => {
  const f = await realLockFixture(t);
  const first = await start(f.manager, update('fail', { cwd: f.cwd }));
  const second = await start(f.manager, update('success', { cwd: f.cwd }));
  await turn();
  assert.deepEqual(f.started, ['fail']);
  f.entries.get('fail').resolve({ ok: false, error: 'network refused' });
  await turn();
  assert.deepEqual(f.started, ['fail', 'success']);
  assert.equal((await status(f.manager, first.id)).state, 'failed');
  f.entries.get('success').resolve({ ok: true, stdout: 'done' });
  assert.equal((await status(f.manager, second.id)).state, 'done');
  assert.equal(f.maxActive(), 1);
});

test('twenty unfinished jobs are retained and only new admission is capped', async (t) => {
  const { manager, entries } = controlled(t);
  const jobs = [];
  for (let index = 0; index < 20; index++) jobs.push(await start(manager, update(`item-${index}`)));
  await assert.rejects(start(manager, update('over-limit')), /At most 20 operations/);
  assert.equal((await start(manager, update('item-0'))).id, jobs[0].id, 'deduplication precedes admission limits');
  const list = await manager.call({ action: 'operation.list' });
  assert.equal(list.items.length, 20);
  assert.equal(list.items.filter((item) => item.state === 'queued').length, 20);
  for (const job of jobs) assert.equal((await manager.call({ action: 'operation.status', id: job.id })).id, job.id);
  entries.get('item-10').resolve({ ok: true });
  await turn();
  const accepted = await start(manager, update('after-slot-freed'));
  assert.equal(accepted.state, 'queued');
  assert.equal((await manager.call({ action: 'operation.list' })).items.length, 21, 'terminal history does not evict active entries');
});

test('only the twenty most recently completed jobs are kept beside active jobs', async (t) => {
  const anchor = deferred();
  const manager = createCompatibilityService({}, {}, () => {}, { pluginOperation: async ({ target }, { signal }) => {
    if (target !== 'anchor') return { ok: true, text: target };
    signal.addEventListener('abort', () => anchor.reject(new Error('cancelled')), { once: true });
    return anchor.promise;
  } });
  t.after(() => manager.dispose());
  const active = await start(manager, update('anchor'));
  const completed = [];
  for (let index = 0; index < 25; index++) {
    const job = await start(manager, update(`history-${index}`));
    completed.push(job);
    assert.equal((await status(manager, job.id)).state, 'done');
  }
  const list = await manager.call({ action: 'operation.list' });
  assert.equal(list.items.length, 21);
  assert.equal(list.items.filter((item) => item.state === 'done').length, 20);
  assert.deepEqual(list.items.filter((item) => item.state === 'done').map((item) => item.target), Array.from({ length: 20 }, (_, index) => `history-${index + 5}`));
  await assert.rejects(manager.call({ action: 'operation.status', id: completed[0].id }), /unavailable/);
  assert.equal((await manager.call({ action: 'operation.status', id: active.id })).state, 'queued');
  assert.equal((await manager.call({ action: 'operation.active' })).id, active.id);
});

test('generation, global revisions and brief list views support recovery without truncating status', async (t) => {
  const { manager, entries } = controlled(t);
  const other = createCompatibilityService({}, {}, () => {}, {});
  t.after(() => other.dispose());
  const initial = await manager.call({ action: 'operation.list' });
  assert.equal(initial.revision, 0); assert.deepEqual(initial.items, []);
  assert.notEqual(initial.generation, (await other.call({ action: 'operation.list' })).generation);
  const job = await start(manager, update('revision'));
  assert.equal(job.generation, initial.generation); assert.equal(typeof job.createdAt, 'number');
  entries.get('revision').progress({ phase: 'running' });
  const running = await status(manager, job.id);
  assert.ok(running.revision > job.revision);
  entries.get('revision').progress({ phase: 'output', text: 'x'.repeat(5000) });
  const full = await status(manager, job.id);
  const brief = await manager.call({ action: 'operation.list' });
  assert.ok(full.revision > running.revision); assert.equal(brief.revision, full.revision);
  assert.ok(full.progress.length > 5000); assert.equal(brief.items[0].progress.length, 2000); assert.equal(brief.items[0].detailsTruncated, true);
  entries.get('revision').resolve({ ok: true, text: 'y'.repeat(6000) });
  const done = await status(manager, job.id);
  assert.ok(done.revision > full.revision);
  const list = await manager.call({ action: 'operation.list' });
  assert.equal(list.items[0].result.text.length, 2000);
  assert.equal(done.result.text.length, 6000);
  list.items[0].result.text = 'caller mutation';
  assert.equal((await status(manager, job.id)).result.text.length, 6000);
  assert.equal((await manager.call({ action: 'operation.list' })).revision, list.revision, 'reads do not increment the service revision');
});

test('duplicate execute cancellation stops only that waiter and owner cancellation affects only its job', async (t) => {
  const { manager, entries } = controlled(t);
  const owner = new AbortController(), duplicate = new AbortController();
  const first = manager.execute(update('first'), owner.signal);
  const joined = manager.execute(update('first'), duplicate.signal);
  const second = manager.execute(update('second'), new AbortController().signal);
  const joinedRejected = assert.rejects(joined, /stop duplicate/);
  duplicate.abort(new Error('stop duplicate'));
  await joinedRejected;
  assert.equal(entries.get('first').signal.aborted, false);
  assert.equal(entries.get('second').signal.aborted, false);
  assert.equal((await manager.call({ action: 'operation.list' })).items.length, 2);
  owner.abort(new Error('stop first owner'));
  assert.equal((await first).ok, false);
  assert.equal(entries.get('second').signal.aborted, false);
  entries.get('second').resolve({ ok: true, text: 'second completed' });
  assert.equal((await second).text, 'second completed');
  assert.deepEqual((await manager.call({ action: 'operation.list' })).items.map((item) => item.state), ['cancelled', 'done']);
});

test('synchronous progress observers cannot make reentrant disposal lose operation ownership', async () => {
  const cleanup = deferred(), entered = deferred();
  let disposal, disposed = false, cleaned = false;
  const manager = createCompatibilityService({}, {}, () => {}, { pluginOperation: async (_request, { signal, onProgress }) => {
    const settled = new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
      cleanup.promise.then(() => { cleaned = true; reject(new Error('cleaned')); });
    }, { once: true }));
    onProgress({ phase: 'running' });
    entered.resolve();
    return settled;
  } });
  const running = manager.execute(update('reentrant'), undefined, () => {
    disposal = manager.dispose().then(() => { disposed = true; });
  });
  await entered.promise;
  await turn();
  assert.equal(disposed, false);
  cleanup.resolve();
  await disposal;
  assert.equal(cleaned, true); assert.equal((await running).ok, false);
});

test('dispose aborts and drains every job, import and independent read before returning', async () => {
  const gate = deferred(), signals = new Map(), cleaned = [];
  function held(role, signal) {
    signals.set(role, signal);
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
      gate.promise.then(() => { cleaned.push(role); reject(new Error(`${role} cancelled`)); });
    }, { once: true }));
  }
  const manager = createCompatibilityService({}, {}, () => {}, {
    pluginOperation: ({ target }, { signal }) => held(target, signal),
    sessionService: {
      importSession: (_request, signal) => held('import', signal),
      listSessions: (_request, signal) => held('read', signal),
    },
  });
  await start(manager, update('first'));
  await start(manager, update('second'));
  const imported = manager.execute({ action: 'sessions.import', cwd: '/project', sessionId: 'source' });
  const read = manager.execute({ action: 'sessions.list', cwd: '/another' }).catch((error) => ({ error }));
  await turn();
  let disposed = false;
  const disposal = manager.dispose().then(() => { disposed = true; });
  await turn();
  assert.equal(disposed, false);
  assert.deepEqual([...signals.keys()].sort(), ['first', 'import', 'read', 'second']);
  for (const signal of signals.values()) assert.equal(signal.aborted, true);
  gate.resolve();
  await disposal;
  assert.deepEqual(cleaned.sort(), ['first', 'import', 'read', 'second']);
  assert.equal((await imported).ok, false); assert.ok((await read).error);
  assert.deepEqual((await manager.call({ action: 'operation.list' })).items, []);
  await assert.rejects(start(manager, update('after-dispose')), /abort/i);
});
