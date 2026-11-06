import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, rm, symlink, utimes, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionImportService } from '../src/session-import.js';
import { claudeProjectFolder } from '../src/lib.js';
import { withEnv } from './env-helper.js';

let native, nativeFailure;
try { native = await import('@deepseek-ai/dsh-session'); }
catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  nativeFailure = error.message;
}
const nativeOnly = { skip: !native && `Current DSH peer unavailable: ${nativeFailure}` };
const cwd = '/work/example project';
const sourceId = '12345678-1234-1234-1234-123456789abc';
const row = (type, content, extra = {}) => ({ type, cwd, timestamp: '2026-11-05T08:00:00Z', message: { role: type, model: 'claude-sonnet-4-5', content }, ...extra });

function persistence() {
  const stored = new Map(), calls = [];
  return {
    stored, calls,
    async stat(id) { const item = stored.get(id); return item && { header: item.header, eventCount: item.events.length, revision: String(item.events.length) }; },
    async open(id, access) {
      assert.equal(access, 'read');
      const item = stored.get(id);
      return { read: async (offset = 0, length = item.events.length) => ({ events: item.events.slice(offset, offset + length), eventState: 'detached' }), close: async () => {} };
    },
    async create(header) {
      calls.push(['create', header.id]);
      if (stored.has(header.id)) throw Object.assign(new Error('exists'), { name: 'SessionAlreadyExistsError' });
      const item = { header, events: [], closed: false };
      stored.set(header.id, item);
      return {
        async append(events) {
          calls.push(['append', header.id]);
          for (const event of events) {
            assert.equal(event.seq, item.events.length);
            if (native) native.adoptSessionEvent(event);
            item.events.push(structuredClone(event));
          }
        },
        async flush() { calls.push(['flush', header.id]); },
        async close() { item.closed = true; calls.push(['close', header.id]); },
      };
    },
  };
}

async function fixture(t, records = [row('user', 'Hello'), row('assistant', [{ type: 'text', text: 'Welcome' }])], config = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dcc-native-import-'));
  const absolute = join(dir, 'claude');
  const project = join(absolute, 'projects', claudeProjectFolder(cwd));
  await mkdir(project, { recursive: true });
  const path = join(project, `${sourceId}.jsonl`);
  await writeFile(path, records.map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join('\n') + '\n');
  t.after(async () => {
    assert.ok(dir.startsWith(join(tmpdir(), 'dcc-native-import-')), 'cleanup stays in its exact generated fixture');
    await rm(dir, { force: true, recursive: true });
  });
  const store = persistence();
  return { dir, absolute, project, path, store, service: createSessionImportService({ sessionPersistence: store }, { userClaudeDir: absolute, ...config }) };
}

test('lists Claude projects and sessions using the configured root', async (t) => {
  const f = await fixture(t);
  const projects = await f.service.listProjects();
  assert.equal(projects.items.length, 1);
  assert.equal(projects.items[0].cwd, cwd);
  const sessions = await f.service.listSessions({ cwd });
  assert.equal(sessions.items[0].id, sourceId);
  assert.equal(sessions.items[0].title, 'Hello');
  assert.equal(sessions.items[0].messages, 2);
  assert.equal(sessions.items[0].messagesExact, true);
  assert.equal(sessions.hasMore, false);
  assert.equal(f.store.calls.length, 0);
});

test('uses CLAUDE_CONFIG_DIR, project-name override, and explicit userClaudeDir precedence', async (t) => {
  const f = await fixture(t);
  await withEnv({ CLAUDE_CONFIG_DIR: f.absolute }, async () => {
    const service = createSessionImportService({ sessionPersistence: f.store });
    assert.equal((await service.listSessions({ cwd })).items[0].id, sourceId);
  });
  await withEnv({ CLAUDE_CONFIG_DIR: join(f.dir, 'wrong-root') }, async () => {
    assert.equal((await f.service.listSessions({ cwd })).items.length, 1);
  });
  await withEnv({ CLAUDE_CONFIG_DIR: f.absolute, CLAUDE_CODE_PROJECT_DIR_NAME: 'custom-project' }, async () => {
    await mkdir(join(f.absolute, 'projects', 'custom-project'));
    await writeFile(join(f.absolute, 'projects', 'custom-project', `${sourceId}.jsonl`), JSON.stringify(row('user', 'Override')) + '\n');
    const service = createSessionImportService({ sessionPersistence: f.store });
    assert.equal((await service.listSessions({ cwd })).items[0].title, 'Override');
  });
});

test('metadata cache invalidates with mtime and size; title query and pagination are bounded', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.service.listSessions({ cwd })).items[0].title, 'Hello');
  await appendFile(f.path, JSON.stringify({ type: 'custom-title', title: 'Renamed conversation' }) + '\n');
  await utimes(f.path, new Date(), new Date(Date.now() + 2000));
  await writeFile(join(f.project, 'another-id.jsonl'), JSON.stringify(row('user', 'Other')) + '\n');
  const result = await f.service.listSessions({ cwd, limit: 1 });
  assert.equal(result.hasMore, true);
  assert.equal(result.items[0].title, 'Renamed conversation');
  assert.equal((await f.service.listSessions({ cwd, query: 'renamed' })).items.length, 1);
  assert.equal((await f.service.listSessions({ cwd, offset: 1, limit: 1 })).items.length, 1);
});

test('preview is bounded and reports malformed JSONL rather than silently dropping it', async (t) => {
  const f = await fixture(t, [row('user', 'Start'), '{bad json', row('assistant', [{ type: 'text', text: 'x'.repeat(50_000) }])]);
  const preview = await f.service.preview({ cwd, sessionId: sourceId });
  assert.equal(preview.items.length, 2);
  assert.equal(preview.items[1].text.length, 4000);
  assert.equal(preview.truncated, true);
  assert.equal(preview.losses.malformedLines, 1);
  assert.deepEqual(preview.losses.malformedLineNumbers, [2]);
  assert.match(preview.warnings.join(' '), /malformed/);
  assert.ok(preview.text.length < 32_200);
});

test('a bounded sample does not claim an exact message count for a large source', async (t) => {
  const f = await fixture(t, Array.from({ length: 1000 }, () => row('user', 'x'.repeat(300))));
  const result = await f.service.listSessions({ cwd });
  assert.equal(result.items[0].messagesExact, false);
  assert.equal(result.items[0].previewTruncated, true);
  assert.ok(result.items[0].messages < 1000);
});

test('archive import rejects cwd collisions while readonly preview uses the recorded original project', async (t) => {
  const a = '/work/a.b', b = '/work/a_b';
  const f = await fixture(t, [row('user', 'Other path', { cwd: a })]);
  const collision = join(f.absolute, 'projects', claudeProjectFolder(a));
  await mkdir(collision);
  await writeFile(join(collision, `${sourceId}.jsonl`), JSON.stringify(row('user', 'Other path', { cwd: a })) + '\n');
  assert.equal((await f.service.listSessions({ cwd: b })).items.length, 0);
  assert.equal((await f.service.preview({ cwd: b, sessionId: sourceId })).cwd, a);
  assert.equal((await f.service.prepareHandoff({ cwd: b, sessionId: sourceId })).cwd, a);
  await assert.rejects(f.service.importSession({ cwd: b, sessionId: sourceId }), /cwd does not match/);
  assert.equal(f.store.calls.length, 0);
});

test('rejects traversal, relative cwd, source symlinks and escaped project directories', async (t) => {
  const f = await fixture(t);
  for (const sessionId of ['../secret', '/secret', 'a/b', '..', 'x\0y']) await assert.rejects(f.service.preview({ cwd, sessionId }), /sessionId/);
  await assert.rejects(f.service.listSessions({ cwd: 'relative' }), /absolute/);
  await symlink(f.path, join(f.project, 'linked.jsonl'));
  await assert.rejects(f.service.preview({ cwd, sessionId: 'linked' }), /symlink/);
  const outside = join(f.dir, 'outside');
  await mkdir(outside);
  const otherCwd = '/other/project';
  await symlink(outside, join(f.absolute, 'projects', claudeProjectFolder(otherCwd)));
  await assert.rejects(f.service.listSessions({ cwd: otherCwd }), /escapes/);
  assert.equal(f.store.calls.length, 0);
});

test('aborted operations never take a persistence write handle', async (t) => {
  const f = await fixture(t);
  const signal = AbortSignal.abort(new Error('cancelled by fixture'));
  await assert.rejects(f.service.listSessions({ cwd }, signal), /cancelled/);
  await assert.rejects(f.service.preview({ cwd, sessionId: sourceId }, signal), /cancelled/);
  await assert.rejects(f.service.importSession({ cwd, sessionId: sourceId }, signal), /cancelled/);
  assert.equal(f.store.calls.length, 0);
});

test('missing projects list empty; malformed pagination fails explicitly', async (t) => {
  const f = await fixture(t);
  const service = createSessionImportService({}, { userClaudeDir: join(f.dir, 'absent') });
  assert.deepEqual((await service.listProjects()).items, []);
  assert.deepEqual((await service.listSessions({ cwd })).items, []);
  for (const request of [{ limit: 0 }, { offset: -1 }, { limit: 1000 }]) await assert.rejects(f.service.listSessions({ cwd, ...request }), /must be an integer/);
});

test('an existing legacy import is returned untouched, including later DSH conversation', async (t) => {
  const f = await fixture(t);
  const existingId = `session-cc-${sourceId}`;
  const later = [{ type: 'user/message', data: { content: [{ type: 'text', text: 'New DSH work' }] } }];
  f.store.stored.set(existingId, { header: { id: existingId, cwd }, events: later, closed: true });
  const result = await f.service.importSession({ cwd, sessionId: sourceId });
  assert.equal(result.sessionId, existingId);
  assert.equal(result.imported, false);
  assert.equal(f.store.stored.get(existingId).events, later);
  assert.equal(f.store.calls.length, 0);
  assert.equal((await f.service.listSessions({ cwd })).items[0].importedSessionId, existingId);
});

test('current-schema import has correct sources, surface markers and tool-call/result pairs', nativeOnly, async (t) => {
  const f = await fixture(t, [
    row('user', 'Read the file'),
    row('assistant', [{ type: 'text', text: 'Reading' }, { type: 'tool_use', id: 'call-1', name: 'Read', input: { file_path: '/work/a.txt' } }]),
    row('user', [{ type: 'tool_result', tool_use_id: 'call-1', content: 'File content' }]),
    row('assistant', [{ type: 'text', text: 'Done' }]),
  ]);
  const result = await f.service.importSession({ cwd, sessionId: sourceId });
  const saved = f.store.stored.get(result.sessionId);
  assert.equal(saved.header.version, native.SESSION_FORMAT_VERSION);
  assert.equal(saved.header.cwd, cwd);
  assert.equal(saved.closed, true);
  assert.equal(result.imported, true);
  const derived = native.Session.fromRestore(result.sessionId, saved.events, saved.header, 0, 'detached').deriveMessages();
  assert.deepEqual(derived.filter((message) => !message.id.endsWith('-import-manifest')).map((message) => message.role), ['user', 'assistant', 'tool', 'assistant']);
  const call = saved.events.find((event) => event.type === 'tool/call');
  const tool = saved.events.find((event) => event.type === 'tool/result');
  assert.equal(tool.data.message.toolCallId, call.data.callId);
  assert.equal(tool.data.message.source.kind, 'tool');
  assert.equal(tool.data.message.content[0].text, 'File content');
  for (const event of saved.events) {
    native.adoptSessionEvent(event);
    if (['user/message', 'assistant/message', 'tool/result'].includes(event.type)) assert.equal(event.surfaceOp, 'append');
  }
  assert.deepEqual(f.store.calls.map(([name]) => name), ['create', 'append', 'flush', 'close']);
});

test('repeat import never overwrites; newSnapshot alone creates a new independent session', nativeOnly, async (t) => {
  const f = await fixture(t);
  const first = await f.service.importSession({ cwd, sessionId: sourceId });
  const saved = f.store.stored.get(first.sessionId);
  saved.events.push({ type: 'test-only-followup', seq: saved.events.length });
  const before = structuredClone(saved.events);
  const repeat = await f.service.importSession({ cwd, sessionId: sourceId });
  assert.equal(repeat.imported, false);
  assert.equal(repeat.sessionId, first.sessionId);
  assert.deepEqual(saved.events, before);
  const snapshot = await f.service.importSession({ cwd, sessionId: sourceId, newSnapshot: true });
  assert.notEqual(snapshot.sessionId, first.sessionId);
  assert.equal(snapshot.imported, true);
  assert.equal(f.store.stored.size, 2);
  assert.deepEqual(saved.events, before);
});

test('concurrent import requests share a single write and current-schema admission', nativeOnly, async (t) => {
  const f = await fixture(t);
  const results = await Promise.all([f.service.importSession({ cwd, sessionId: sourceId }), f.service.importSession({ cwd, sessionId: sourceId })]);
  assert.equal(results[0].sessionId, results[1].sessionId);
  assert.equal(f.store.calls.filter(([name]) => name === 'create').length, 1);
});

test('import reports malformed lines, omitted reasoning/attachments and absent tool results', nativeOnly, async (t) => {
  const f = await fixture(t, [
    row('user', 'Old task'), row('assistant', [{ type: 'text', text: 'Old reply' }]),
    '{bad json', row('user', [{ type: 'text', text: 'Latest task' }, { type: 'image', source: { data: 'not-imported' } }]),
    row('assistant', [{ type: 'thinking', thinking: 'must not leak' }, { type: 'tool_use', id: 'pending', name: 'Bash', input: { command: 'write-operation' } }]),
    row('assistant', [{ type: 'text', text: 'subagent' }], { isSidechain: true }),
  ]);
  const result = await f.service.importSession({ cwd, sessionId: sourceId, limitTurns: 1 });
  assert.equal(result.losses.malformedLines, 1);
  assert.equal(result.losses.omittedTurns, 1);
  assert.equal(result.losses.sidechainRecords, 1);
  assert.equal(result.losses.missingToolResults, 1);
  assert.equal(result.losses.unsupportedBlocks, 2);
  const saved = f.store.stored.get(result.sessionId);
  const serialized = JSON.stringify(saved.events.filter((event) => event.type !== 'session/title'));
  assert.doesNotMatch(serialized, /must not leak|Old task/);
  assert.match(serialized, /reasoning is not replayed|not restored/);
  assert.match(serialized, /Verify external state/);
  assert.equal(saved.events.find((event) => event.type === 'tool/result').data.message.isError, true);
  native.Session.fromRestore(result.sessionId, saved.events, saved.header, 0, 'detached').deriveMessages();
});

test('split assistant records keep parallel tool calls paired with their actual results', nativeOnly, async (t) => {
  const sameResponse = { id: 'claude-response-1', model: 'claude-sonnet-4-5' };
  const f = await fixture(t, [
    row('user', 'Read two files'),
    row('assistant', [], { message: { ...sameResponse, content: [{ type: 'tool_use', id: 'a', name: 'Read', input: { file_path: '/a' } }] } }),
    row('assistant', [], { message: { ...sameResponse, content: [{ type: 'tool_use', id: 'b', name: 'Read', input: { file_path: '/b' } }] } }),
    row('user', [{ type: 'tool_result', tool_use_id: 'a', content: 'A' }, { type: 'tool_result', tool_use_id: 'b', content: 'B' }]),
  ]);
  const result = await f.service.importSession({ cwd, sessionId: sourceId });
  assert.equal(result.losses.missingToolResults, 0);
  assert.equal(result.losses.orphanToolResults, 0);
  const events = f.store.stored.get(result.sessionId).events;
  assert.equal(events.filter((event) => event.type === 'tool/call').length, 2);
  assert.deepEqual(events.filter((event) => event.type === 'tool/result').map((event) => event.data.message.content[0].text), ['A', 'B']);
});

test('incomplete import receipts prevent reuse while continued completed imports remain readable', nativeOnly, async (t) => {
  const f = await fixture(t);
  const first = await f.service.importSession({ cwd, sessionId: sourceId });
  const item = f.store.stored.get(first.sessionId);
  item.events.pop();
  const listing = await f.service.listSessions({ cwd });
  assert.equal(listing.items[0].importStatus, 'incomplete');
  await assert.rejects(f.service.importSession({ cwd, sessionId: sourceId }), /incomplete.*newSnapshot/);
  const second = await f.service.importSession({ cwd, sessionId: sourceId, newSnapshot: true });
  assert.notEqual(second.sessionId, first.sessionId);
  assert.equal(f.store.calls.filter(([name]) => name === 'create').length, 2);
});

test('a source growing after the preflight cannot bypass the actual byte budget', async (t) => {
  const f = await fixture(t, [row('user', 'Small initial transcript')], { sessionImportMaxBytes: 1024 });
  const probe = await open(f.path);
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const originalRead = prototype.read;
  let grown = false;
  t.mock.method(prototype, 'read', async function (...args) {
    if (!grown) { grown = true; await appendFile(f.path, JSON.stringify(row('assistant', [{ type: 'text', text: 'x'.repeat(5000) }])) + '\n'); }
    return originalRead.apply(this, args);
  });
  await assert.rejects(f.service.importSession({ cwd, sessionId: sourceId }), /exceeds the 1024 byte import limit/);
  assert.equal(grown, true);
  assert.equal(f.store.calls.length, 0);
});

test('persistence failures close write ownership and report the partial-session identity', nativeOnly, async (t) => {
  const f = await fixture(t);
  let closed = false;
  const service = createSessionImportService({ sessionPersistence: {
    stat: async () => undefined,
    create: async () => ({ append: async () => { throw new Error('disk full'); }, flush: async () => {}, close: async () => { closed = true; } }),
  } }, { userClaudeDir: f.absolute });
  await assert.rejects(service.importSession({ cwd, sessionId: sourceId }), /incomplete new session.*newSnapshot.*disk full/);
  assert.equal(closed, true);
});
