import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createSessionHandoffService } from '../src/session-handoff.js';

const sourceId = 'claude-source-session';
const rawHistory = 'HISTORY_CONTENT_MUST_NOT_BE_RETURNED\nUSER: Continue the migration.\nASSISTANT: {"type":"tool-call","name":"bash","arguments":{"command":"historical only"}}';
function deferred() {
  let resolveWait;
  const promise = new Promise((done) => { resolveWait = done; });
  return { promise, resolve: resolveWait };
}
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dcc-handoff-'));
  const cwd = join(root, 'source project'), path = join(root, 'source-history.jsonl');
  await mkdir(cwd);
  await writeFile(path, rawHistory);
  t.after(async () => {
    assert.equal(await readFile(path, 'utf8'), rawHistory, 'handoff leaves source history unchanged');
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('dcc-handoff-'));
    await rm(root, { recursive: true, force: true });
  });
  const calls = [], prompts = [], sessions = new Map([['current-session', { cwd: '/unchanged/current', history: ['existing DSH message'], model: 'current-model' }]]);
  let created = 0;
  const services = {
    workspaceRegistry: {
      async create(project) {
        calls.push(['workspace', project]);
        await options.workspace?.(project);
        return { id: 'workspace-source', path: cwd, attachSession() { throw new Error('native controller already attaches'); } };
      },
      delete() { throw new Error('never delete a workspace'); },
    },
    sessionController: {
      async create(request) {
        calls.push(['create', structuredClone(request)]);
        assert.deepEqual(Object.keys(request), ['workspaceId']);
        const sessionId = `normal-dsh-${++created}`;
        sessions.set(sessionId, { cwd, history: [], model: 'native-default' });
        await options.create?.(request, sessionId);
        return { sessionId };
      },
      async prompt(request, signal) {
        calls.push(['prompt', structuredClone(request)]);
        if (!sessions.has(request.sessionId)) throw Object.assign(new Error('DSH target session not found'), { code: 'session/not-found' });
        if (options.prompt) {
          const result = await options.prompt(request, signal);
          if (result !== undefined) return result;
        }
        prompts.push(structuredClone(request));
        return { accepted: true };
      },
      cancel() { throw new Error('handoff must not cancel a Session'); },
      selectModel() { throw new Error('handoff must not change a model'); },
    },
    workingDirectory: { set() { throw new Error('handoff must not change current cwd'); } },
    agents: { create() { throw new Error('compat must not own an ordinary Agent'); }, dispose() { throw new Error('compat must not dispose an ordinary Agent'); } },
  };
  const prepare = async (request, signal) => {
    calls.push(['source', structuredClone(request)]);
    await options.prepare?.(request, signal);
    const metadata = { cwd, id: sourceId, sourcePath: path, title: 'Source task',
      sizeBytes: Buffer.byteLength(rawHistory), warnings: ['Fixture warning'] };
    // Preserve accessors so a forbidden text read cannot be hidden by fixture spreading.
    if (options.source) Object.defineProperties(metadata, Object.getOwnPropertyDescriptors(options.source));
    return metadata;
  };
  const ctx = options.plainContext ? services : { get(name) { return services[name]; },
    get workspaceRegistry() { throw new Error('Cordis access must use ctx.get'); },
    get sessionController() { throw new Error('Cordis access must use ctx.get'); },
  };
  if (options.missing) delete services[options.missing];
  const handoff = createSessionHandoffService(ctx, {}, prepare);
  return { root, cwd, path, calls, prompts, sessions, services, handoff,
    request: { cwd: '/profile/is-only-a-source-locator', sessionId: sourceId }, created: () => created };
}
const signal = () => new AbortController().signal;

function assertThinReceipt(receipt) {
  assert.equal(JSON.stringify(receipt).includes('HISTORY_CONTENT_MUST_NOT_BE_RETURNED'), false);
  assert.equal('text' in receipt, false);
  assert.equal('content' in receipt, false);
}
function assertReadingPrompt(text, sourcePath, cwd) {
  assert.ok(text.includes(JSON.stringify(sourcePath)), 'source path is an unambiguous JSON reference');
  assert.ok(text.includes(JSON.stringify(cwd)), 'source project is metadata, not a transcript');
  assert.match(text, /请阅读(?:并)?理解/);
  assert.match(text, /背景、当前任务状态和下一步计划/);
  assert.match(text, /分段读取|按需检索/);
  assert.equal(text.includes(rawHistory), false);
  assert.equal(text.includes('HISTORY_CONTENT_MUST_NOT_BE_RETURNED'), false);
  assert.doesNotMatch(text, /继续处理明确的待办|请接手并继续|继续原任务|HISTORICAL_TOOL_CALL/);
  assert.ok(text.length < 1024 + sourcePath.length * 2 + cwd.length * 2, 'prompt size follows references, not history size');
}

test('new handoff reads source, opens its actual workspace and admits a normal DSH session', async (t) => {
  const f = await fixture(t);
  const result = await f.handoff.resume(f.request, signal(), undefined, 'new-request');
  assert.deepEqual(f.calls.map(([kind]) => kind), ['source', 'workspace', 'create', 'prompt']);
  assert.equal(f.calls[1][1], f.cwd);
  assert.deepEqual(f.calls[2][1], { workspaceId: 'workspace-source' });
  assert.equal(result.ok, true); assert.equal(result.accepted, true);
  assert.equal(result.destination, 'new'); assert.equal(result.sessionId, 'normal-dsh-1');
  assert.equal(result.cwd, f.cwd); assert.equal(result.sourceCwd, f.cwd);
  assert.equal(result.sourcePath, f.path); assert.equal(result.workspaceId, 'workspace-source');
  assert.equal(result.title, 'Source task'); assert.equal('messages' in result, false, 'metadata preparation does not count transcript messages');
  assert.deepEqual(result.warnings, ['Fixture warning']);
  const prompt = f.prompts[0];
  assert.equal(prompt.requestId, 'new-request'); assert.equal(prompt.mode, 'queue');
  assert.deepEqual(prompt.content.map((part) => part.type), ['text']);
  assertReadingPrompt(prompt.content[0].text, f.path, f.cwd);
  assert.equal(f.created(), 1);
  assertThinReceipt(result);
});

test('current handoff only queues background into its exact target and preserves existing state', async (t) => {
  const f = await fixture(t, { plainContext: true, missing: 'workspaceRegistry' });
  const before = structuredClone(f.sessions.get('current-session'));
  const result = await f.handoff.resume({ ...f.request, targetSessionId: 'current-session', limitTurns: 50 }, signal(), undefined, 'current-request');
  assert.deepEqual(f.calls.map(([kind]) => kind), ['source', 'prompt']);
  assert.equal(result.destination, 'current'); assert.equal(result.sessionId, 'current-session');
  assert.equal(result.sourceCwd, f.cwd); assert.equal('cwd' in result, false);
  assert.equal('workspaceId' in result, false);
  assert.equal(f.prompts[0].mode, 'queue');
  assert.equal(f.prompts[0].sessionId, 'current-session');
  assertReadingPrompt(f.prompts[0].content[0].text, f.path, f.cwd);
  assert.match(f.prompts[0].content[0].text, /最近\s*50\s*轮/);
  assert.deepEqual(f.sessions.get('current-session'), before);
  assert.equal(f.calls[0][1].limitTurns, 50);
  assertThinReceipt(result);
});

test('handoff never accesses a prepared source text getter', async (t) => {
  const metadata = Object.defineProperty({}, 'text', { enumerable: true,
    get() { throw new Error('transcript body must never be read for handoff'); } });
  const f = await fixture(t, { source: metadata });
  const result = await f.handoff.resume(f.request, signal(), undefined, 'metadata-only');
  assert.equal(result.ok, true, result.error);
  assert.equal(result.accepted, true);
  assertReadingPrompt(f.prompts[0].content[0].text, f.path, f.cwd);
  assertThinReceipt(result);
});

test('the same source reference produces an identical short prompt above one GiB', async (t) => {
  const metadata = { sizeBytes: 64 };
  const f = await fixture(t, { source: metadata });
  assert.equal((await f.handoff.resume(f.request, signal(), undefined, 'small-source')).ok, true);
  metadata.sizeBytes = 2 ** 30 + 4096;
  assert.equal((await f.handoff.resume(f.request, signal(), undefined, 'large-source')).ok, true);
  const [small, large] = f.prompts.map((prompt) => prompt.content[0].text);
  assert.equal(large, small, 'file size does not add transcript content or size-dependent instructions');
  assertReadingPrompt(large, f.path, f.cwd);
  assert.ok(large.length < 1024);
  assert.equal(f.created(), 2, 'reference-only prompts retain ordinary fresh-session behavior');
});

test('concurrent and completed retries share one request receipt and detached metadata', async (t) => {
  const gate = deferred();
  const f = await fixture(t, { prepare: () => gate.promise });
  const request = { ...f.request, action: 'sessions.resume' };
  const first = f.handoff.resume(request, signal(), undefined, 'stable');
  const duplicate = f.handoff.resume({ sessionId: sourceId, cwd: request.cwd }, signal(), undefined, 'stable');
  request.cwd = '/changed-after-acceptance';
  gate.resolve();
  const [one, two] = await Promise.all([first, duplicate]);
  assert.deepEqual(one, two); assert.equal(f.created(), 1); assert.equal(f.prompts.length, 1);
  one.warnings.push('caller mutation');
  const replay = await f.handoff.resume(f.request, signal(), undefined, 'stable');
  assert.deepEqual(replay.warnings, ['Fixture warning']);
  assert.equal(f.calls[0][1].cwd, '/profile/is-only-a-source-locator');
  await assert.rejects(f.handoff.resume({ ...f.request, targetSessionId: 'current-session' }, signal(), undefined, 'stable'), /different parameters/);
  assert.equal(f.created(), 1); assert.equal(f.prompts.length, 1);
});

test('metadata failure and invalid prepared references create no workspace or target', async (t) => {
  const f = await fixture(t, { prepare: async () => { throw new Error('fixture history cannot be read'); } });
  const failed = await f.handoff.resume(f.request, signal(), undefined, 'unreadable');
  assert.equal(failed.ok, false); assert.equal(failed.accepted, false);
  assert.match(failed.error, /cannot be read/);
  assert.deepEqual(f.calls.map(([kind]) => kind), ['source']);
  for (const source of [{ sourcePath: '' }, { sourcePath: 'relative-history.jsonl' }, { cwd: 'relative-project' }]) {
    const invalid = await fixture(t, { source });
    const result = await invalid.handoff.resume(invalid.request, signal(), undefined, 'invalid-reference');
    assert.equal(result.ok, false);
    assert.match(result.error, /Source path|Source project|must be absolute/);
    assert.deepEqual(invalid.calls.map(([kind]) => kind), ['source']);
  }
});

test('missing native services and an unknown current target fail without any new-session fallback', async (t) => {
  for (const missing of ['sessionController', 'workspaceRegistry']) {
    const f = await fixture(t, { missing });
    const result = await f.handoff.resume(f.request, signal(), undefined, `missing-${missing}`);
    assert.equal(result.ok, false); assert.match(result.error, /unavailable/);
    assert.deepEqual(f.calls.map(([kind]) => kind), ['source']);
  }
  const f = await fixture(t);
  const result = await f.handoff.resume({ ...f.request, targetSessionId: 'unknown-target' }, signal(), undefined, 'unknown');
  assert.equal(result.ok, false); assert.equal(result.sessionId, 'unknown-target');
  assert.match(result.error, /not found/);
  assert.equal(result.code, 'session/not-found'); assert.equal(result.accepted, false);
  assert.equal(result.delivery, 'not-accepted'); assert.equal('unknown' in result, false);
  assert.deepEqual(f.calls.map(([kind]) => kind), ['source', 'prompt']);
  assert.equal(f.created(), 0);
});

test('cancellation before reading or before workspace creation admits no target', async (t) => {
  const f = await fixture(t);
  const first = new AbortController(); first.abort(new Error('stop before reading'));
  const one = await f.handoff.resume(f.request, first.signal, undefined, 'initial-abort');
  assert.equal(one.cancelled, true); assert.equal(f.calls.length, 0);
  const second = new AbortController();
  const two = await f.handoff.resume(f.request, second.signal, (message) => {
    if (message.includes('Opening')) second.abort(new Error('stop before workspace'));
  }, 'before-create');
  assert.equal(two.cancelled, true);
  assert.deepEqual(f.calls.map(([kind]) => kind), ['source']);
});

test('cancellation after workspace creation retains its receipt and skips normal-session creation', async (t) => {
  const owner = new AbortController();
  const f = await fixture(t, { workspace: async () => owner.abort(new Error('stop after workspace')) });
  const result = await f.handoff.resume(f.request, owner.signal, undefined, 'workspace-abort');
  assert.equal(result.ok, false); assert.equal(result.cancelled, true); assert.equal(result.partial, true);
  assert.equal(result.workspaceId, 'workspace-source'); assert.equal('sessionId' in result, false);
  assert.deepEqual(f.calls.map(([kind]) => kind), ['source', 'workspace']);
});

test('cancellation before prompt admission retains the newly created ordinary Session', async (t) => {
  const owner = new AbortController();
  const f = await fixture(t);
  const result = await f.handoff.resume(f.request, owner.signal, () => {
    if (f.created() === 1 && !f.calls.some(([kind]) => kind === 'prompt')) owner.abort(new Error('stop before prompt'));
  }, 'preprompt-abort');
  assert.equal(result.ok, false); assert.equal(result.accepted, false); assert.equal(result.cancelled, true);
  assert.equal(result.partial, true); assert.equal(result.sessionId, 'normal-dsh-1');
  assert.equal(f.sessions.has(result.sessionId), true);
  assert.deepEqual(f.calls.map(([kind]) => kind), ['source', 'workspace', 'create']);
  const replay = await f.handoff.resume(f.request, signal(), undefined, 'preprompt-abort');
  assert.deepEqual(replay, result); assert.equal(f.created(), 1);
});

test('an accepted handoff remains successful after owner cancellation and never cancels its Agent', async (t) => {
  const owner = new AbortController();
  const f = await fixture(t, { prompt: async () => { owner.abort(new Error('admission already happened')); return { accepted: true }; } });
  const result = await f.handoff.resume(f.request, owner.signal, undefined, 'accepted-abort');
  assert.equal(owner.signal.aborted, true); assert.equal(result.ok, true); assert.equal(result.accepted, true);
  assert.equal('cancelled' in result, false);
  assert.equal(f.sessions.has(result.sessionId), true);
  assert.deepEqual(await f.handoff.resume(f.request, owner.signal, undefined, 'accepted-abort'), result);
  assert.equal(f.created(), 1); assert.equal(f.calls.filter(([kind]) => kind === 'prompt').length, 1);
});

test('prompt failure and missing acknowledgement retain a thin partial target receipt without retrying', async (t) => {
  for (const prompt of [async () => { throw new Error('native prompt failed'); }, async () => ({ accepted: false })]) {
    const f = await fixture(t, { prompt });
    const result = await f.handoff.resume(f.request, signal(), undefined, 'failed-prompt');
    assert.equal(result.ok, false); assert.equal(result.partial, true); assert.equal(result.failedAt, 'prompt');
    if (result.unknown) {
      assert.equal(result.delivery, 'not-confirmed'); assert.equal('accepted' in result, false);
      assert.match(result.error, /check target DSH conversation normal-dsh-1/);
    } else { assert.equal(result.accepted, false); assert.equal(result.delivery, 'not-accepted'); }
    assert.equal(result.sessionId, 'normal-dsh-1'); assert.equal(result.workspaceId, 'workspace-source');
    assert.equal(f.sessions.has(result.sessionId), true);
    assertThinReceipt(result);
    assert.deepEqual(await f.handoff.resume(f.request, signal(), undefined, 'failed-prompt'), result);
    assert.equal(f.created(), 1); assert.equal(f.calls.filter(([kind]) => kind === 'prompt').length, 1);
  }
});

test('native create attachment failure preserves the already persisted Session identity and native code', async (t) => {
  const f = await fixture(t, { create: async (_request, sessionId) => {
    throw Object.assign(new Error('Workspace attachment failed after Session persistence'), {
      code: 'session/workspace-attach-failed', details: { sessionId, workspaceId: 'workspace-source' },
    });
  } });
  const result = await f.handoff.resume(f.request, signal(), undefined, 'attach-failed');
  assert.equal(result.ok, false); assert.equal(result.accepted, false); assert.equal(result.partial, true);
  assert.equal(result.code, 'session/workspace-attach-failed'); assert.equal(result.failedAt, 'create-session');
  assert.equal(result.sessionId, 'normal-dsh-1'); assert.equal(result.workspaceId, 'workspace-source');
  assert.equal(f.sessions.has(result.sessionId), true);
  assert.deepEqual(f.calls.map(([kind]) => kind), ['source', 'workspace', 'create']);
  assert.deepEqual(await f.handoff.resume(f.request, signal(), undefined, 'attach-failed'), result);
  assert.equal(f.created(), 1);
});

test('unknown prompt interruption reports unconfirmed delivery and preserves the target without resending', async (t) => {
  const owner = new AbortController();
  const f = await fixture(t, { prompt: async () => {
    owner.abort(new Error('Caller disconnected while admission was pending'));
    throw Object.assign(new Error('Native admission reply interrupted'), { code: 'gateway/internal' });
  } });
  const result = await f.handoff.resume(f.request, owner.signal, undefined, 'unconfirmed');
  assert.equal(result.ok, false); assert.equal(result.unknown, true); assert.equal(result.cancelled, true);
  assert.equal(result.delivery, 'not-confirmed'); assert.equal(result.failedAt, 'prompt');
  assert.equal(result.code, 'gateway/internal'); assert.equal('accepted' in result, false);
  assert.equal(result.sessionId, 'normal-dsh-1'); assert.equal(result.workspaceId, 'workspace-source');
  assert.match(result.error, /check target DSH conversation normal-dsh-1/);
  assert.deepEqual(await f.handoff.resume(f.request, signal(), undefined, 'unconfirmed'), result);
  assert.equal(f.created(), 1); assert.equal(f.calls.filter(([kind]) => kind === 'prompt').length, 1);
});

test('receipt history covers twenty completions without evicting an active request', async (t) => {
  const gate = deferred();
  const f = await fixture(t, { prepare: (request) => request.limitTurns === 1 ? gate.promise : undefined });
  const activeRequest = { ...f.request, limitTurns: 1 };
  const active = f.handoff.resume(activeRequest, signal(), undefined, 'active-receipt');
  for (let index = 0; index < 20; index++) {
    const result = await f.handoff.resume(f.request, signal(), undefined, `finished-${index}`);
    assert.equal(result.ok, true);
  }
  const duplicate = f.handoff.resume(activeRequest, signal(), undefined, 'active-receipt');
  for (let index = 0; index < 20; index++) {
    await f.handoff.resume(f.request, signal(), undefined, `finished-${index}`);
  }
  assert.equal(f.created(), 20);
  gate.resolve();
  assert.deepEqual(await active, await duplicate);
  assert.equal(f.created(), 21);
  assert.equal(f.calls.filter(([kind]) => kind === 'prompt').length, 21);
});

test('invalid parameters reject before reading and display observers cannot block admission', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.handoff.resume({ ...f.request, targetSessionId: '' }, signal(), undefined, 'bad'), /targetSessionId/);
  await assert.rejects(f.handoff.resume({ ...f.request, newSnapshot: true }, signal(), undefined, 'bad'), /Unknown handoff/);
  await assert.rejects(f.handoff.resume({ ...f.request, limitTurns: 0 }, signal(), undefined, 'bad'), /limitTurns/);
  assert.equal(f.calls.length, 0);
  const result = await f.handoff.resume(f.request, signal(), () => { throw new Error('display observer failed'); }, 'observer');
  assert.equal(result.ok, true); assert.equal(f.created(), 1);
  const asynchronous = await f.handoff.resume(f.request, signal(), async () => { throw new Error('async display observer failed'); }, 'async-observer');
  assert.equal(asynchronous.ok, true); assert.equal(f.created(), 2);
});
