import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createCompatibilityService, isCompatMutation, operationKey } from '../src/compat-service.js';

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}
function fakeModel() {
  const calls = [], ready = [], waiting = [];
  return {
    calls,
    nextCall() { return ready.length ? Promise.resolve(ready.shift()) : new Promise((resolve) => waiting.push(resolve)); },
    stream(options) {
      const entry = { options, ...deferred() };
      calls.push(entry);
      if (waiting.length) waiting.shift()(entry); else ready.push(entry);
      return (async function* () {
        const { text = 'translated', kind = 'stop' } = await entry.promise;
        yield { type: 'text-delta', text };
        yield { type: 'finish', reason: { kind, failure: { message: 'fake provider error' } } };
      })();
    },
  };
}
async function fixture(t, { text = 'A'.repeat(4001), timeoutMs, services = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dcc-translation-job-'));
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('dcc-translation-job-'));
  const userClaudeDir = join(root, 'user'), cwd = join(root, 'project'), cacheDir = join(root, 'cache');
  await mkdir(join(cwd, '.claude', 'rules'), { recursive: true });
  await mkdir(join(cwd, '.dsh'));
  await mkdir(userClaudeDir);
  await writeFile(join(cwd, '.claude', 'rules', 'translation.md'), text);
  const oldCache = process.env.DSH_CLAUDE_COMPAT_TRANSLATE_CACHE;
  process.env.DSH_CLAUDE_COMPAT_TRANSLATE_CACHE = cacheDir;
  const llm = fakeModel();
  const service = createCompatibilityService({ llm, agentDefaultModel: { currentSelection: () => ({ provider: 'fixture', model: 'fake' }) }, ...services },
    { userClaudeDir, pluginsRoot: join(userClaudeDir, 'plugins'), projectRootMarkers: ['.dsh'] }, () => {}, { translationTimeoutMs: timeoutMs });
  t.after(async () => {
    await service.dispose();
    for (const entry of llm.calls) entry.resolve({});
    if (oldCache === undefined) delete process.env.DSH_CLAUDE_COMPAT_TRANSLATE_CACHE;
    else process.env.DSH_CLAUDE_COMPAT_TRANSLATE_CACHE = oldCache;
    await rm(root, { recursive: true, force: true });
  });
  const inventory = await service.execute({ action: 'inventory.list', cwd });
  const item = inventory.items.find((item) => item.kind === 'rule' && item.name === 'translation.md');
  assert.ok(item, 'fixture rule is installed in the real inventory');
  const request = { action: 'inventory.translate', cwd, id: item.id, lang: 'en' };
  return { service, llm, request, cacheDir };
}
const start = (service, request) => service.call({ action: 'operation.start', request });
const status = (service, id) => service.call({ action: 'operation.status', id });

test('translation keys include project, item and normalized language, but exclude force', () => {
  assert.equal(isCompatMutation('inventory.translate'), true);
  const request = { action: 'inventory.translate' };
  assert.equal(operationKey(request), JSON.stringify(['translation', '', '', 'en']));
  assert.equal(operationKey({ ...request, cwd: '/one', id: 'rule', lang: 'zh', force: true }), JSON.stringify(['translation', '/one', 'rule', 'zh']));
  assert.notEqual(operationKey({ ...request, cwd: '/one' }), operationKey({ ...request, cwd: '/two' }));
});

test('start and execute share one translation; status/list restore metadata and completed chunks', async (t) => {
  const { service, llm, request } = await fixture(t);
  const viewer = new AbortController();
  const job = await service.call({ action: 'operation.start', request }, viewer.signal);
  const first = await llm.nextCall();
  viewer.abort(new Error('viewer closed'));
  const duplicateRequest = { action: 'operation.start', request: { ...request, force: true }, id: randomUUID() };
  const duplicate = await service.call(duplicateRequest);
  assert.equal(duplicate.id, job.id);
  assert.equal((await service.call(duplicateRequest)).id, job.id, 'force-changing alias receipts replay idempotently');
  const execution = service.execute({ ...request, force: true });
  let snapshot = await status(service, job.id);
  assert.equal(snapshot.state, 'running');
  assert.notEqual(snapshot.id, request.id);
  assert.equal(snapshot.itemId, request.id);
  assert.equal(snapshot.lang, 'en');
  assert.equal(snapshot.cwd, request.cwd);
  assert.equal(snapshot.createdAt, job.createdAt);
  assert.deepEqual(snapshot.translationProgress, { completed: 0, total: 2, backend: 'model' });
  assert.match(snapshot.progress, /\[\d{4}-.*\] Translation 0\/2 chunks · model · \d+s elapsed/);
  assert.equal(first.options.signal.aborted, false, 'viewer close does not abort the service-owned job');
  assert.equal(llm.calls.length, 1);
  first.resolve({ text: 'one' });
  const second = await llm.nextCall();
  snapshot = await status(service, job.id);
  assert.deepEqual(snapshot.translationProgress, { completed: 1, total: 2, backend: 'model' });
  const restored = (await service.call({ action: 'operation.list' })).items.find((entry) => entry.id === job.id);
  assert.equal(restored.action, request.action);
  assert.equal(restored.itemId, request.id);
  assert.equal(restored.cwd, request.cwd);
  assert.equal(restored.lang, request.lang);
  assert.deepEqual(restored.translationProgress, snapshot.translationProgress);
  second.resolve({ text: 'two' });
  const result = await execution;
  assert.deepEqual(result, { ok: true, content: 'onetwo', cached: false, calls: 2, backend: 'model', bytes: 4001,
    sourceHash: createHash('sha256').update('A'.repeat(4001)).digest('hex') });
  snapshot = await status(service, job.id);
  assert.equal(snapshot.state, 'done');
  assert.deepEqual(snapshot.translationProgress, { completed: 2, total: 2, backend: 'model' });
  assert.deepEqual(snapshot.result, result);
  const brief = (await service.call({ action: 'operation.list' })).items.find((entry) => entry.id === job.id);
  assert.equal(brief.result.content, undefined, 'list polls omit translated documents');
  assert.equal(brief.result.sourceHash, result.sourceHash);
  assert.equal(brief.result.backend, 'model');
  assert.equal(brief.detailsTruncated, true);
  const cached = await service.execute(request);
  assert.equal(cached.cached, true);
  assert.equal(cached.backend, 'cache');
  assert.equal(llm.calls.length, 2);
});

test('execute owns a tracked job and duplicate execute/start requests never repeat its model call', async (t) => {
  const { service, llm, request } = await fixture(t, { text: 'short rule' });
  const one = service.execute(request);
  const call = await llm.nextCall();
  const two = service.execute({ ...request, force: true });
  const job = await start(service, request);
  assert.equal(job.itemId, request.id);
  assert.equal(llm.calls.length, 1);
  call.resolve({ text: 'done' });
  assert.deepEqual(await one, await two);
  assert.equal((await status(service, job.id)).result.content, 'done');
});

test('model completion preserves source separators around code and paragraphs', async (t) => {
  const text = 'Intro\n\n  ````md\n```\nconst keep = 1;\n```\n  ````\n\nOutro\n';
  const { service, llm, request } = await fixture(t, { text });
  const execution = service.execute(request);
  const first = await llm.nextCall();
  assert.equal(first.options.messages[0].content[0].text, 'Intro');
  first.resolve({ text: '开头' });
  const second = await llm.nextCall();
  assert.equal(second.options.messages[0].content[0].text, 'Outro');
  second.resolve({ text: '结尾' });
  const result = await execution;
  assert.equal(result.content, text.replace('Intro', '开头').replace('Outro', '结尾'));
  assert.equal(llm.calls.length, 2);
});

test('truncated model output fails without cache writes and a new operation retries successfully', async (t) => {
  const { service, llm, request, cacheDir } = await fixture(t, { text: 'short rule' });
  const failed = service.execute(request);
  (await llm.nextCall()).resolve({ text: 'partial', kind: 'max-tokens' });
  assert.match((await failed).error, /token limit/);
  const previous = (await service.call({ action: 'operation.list' })).items[0];
  assert.equal(previous.state, 'failed');
  assert.deepEqual(previous.translationProgress, { completed: 0, total: 1, backend: 'model' });
  assert.deepEqual(await readdir(cacheDir).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error)), []);
  const retry = service.execute(request);
  (await llm.nextCall()).resolve({ text: 'complete' });
  assert.equal((await retry).content, 'complete');
  assert.equal(llm.calls.length, 2);
  assert.notEqual((await service.call({ action: 'operation.list' })).items.at(-1).id, previous.id);
});

test('chunk deadline aborts stalled model iteration and permits retry without caching late output', async (t) => {
  const { service, llm, request, cacheDir } = await fixture(t, { text: 'short rule', timeoutMs: 20 });
  const execution = service.execute(request);
  const stalled = await llm.nextCall();
  const result = await execution;
  assert.equal(result.ok, false);
  assert.match(result.error, /timed out/);
  assert.equal(stalled.options.signal.aborted, true);
  stalled.resolve({ text: 'late partial' });
  const retry = service.execute(request);
  (await llm.nextCall()).resolve({ text: 'recovered' });
  assert.equal((await retry).content, 'recovered');
  const cachedFiles = await readdir(cacheDir);
  assert.equal(cachedFiles.length, 1);
});

test('cancel and service disposal abort the model signal even if the adapter ignores it', async (t) => {
  const { service, llm, request, cacheDir } = await fixture(t, { text: 'short rule' });
  const job = await start(service, request);
  const first = await llm.nextCall();
  const cancelled = await service.call({ action: 'operation.cancel', id: job.id });
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(first.options.signal.aborted, true);
  const retry = await start(service, request);
  assert.notEqual(retry.id, job.id);
  const second = await llm.nextCall();
  await service.dispose();
  assert.equal(second.options.signal.aborted, true);
  first.resolve({ text: 'late first' }); second.resolve({ text: 'late second' });
  assert.deepEqual(await readdir(cacheDir).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error)), []);
});
