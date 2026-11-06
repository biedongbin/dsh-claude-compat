import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, open, symlink, rm, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { createSessionImportService } from '../src/session-import.js';
import { claudeProjectsDir } from '../src/lib.js';

const origin = '/fixture/original-project';
const sourceId = 'fixture-handoff';
const SAMPLE_BYTES = 128 * 1024;
const row = (type, content, extra = {}) => ({ type, cwd: origin, message: { role: type, content }, ...extra });
async function fixture(t, records, { lookupCwd = origin, ...config } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dcc-handoff-'));
  const userClaudeDir = join(root, 'claude');
  const project = claudeProjectsDir(lookupCwd, userClaudeDir);
  const path = join(project, `${sourceId}.jsonl`);
  await mkdir(project, { recursive: true });
  await writeFile(path, records.map((record) => typeof record === 'string' ? record : JSON.stringify(record)).join('\n') + '\n');
  const service = createSessionImportService({
    get sessionPersistence() { throw new Error('handoff must never access DSH persistence'); },
  }, { userClaudeDir, ...config });
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('dcc-handoff-'));
    await rm(root, { recursive: true, force: true });
  });
  return { service, root, userClaudeDir, path, project, lookupCwd, request: { cwd: lookupCwd, sessionId: sourceId } };
}

async function observeReads(t, path, beforeRead) {
  const probe = await open(path);
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const original = prototype.read, calls = [], handles = new Set();
  let bytes = 0;
  const wrapped = t.mock.method(prototype, 'read', async function (...args) {
    calls.push({ length: args[2], position: args[3] }); handles.add(this);
    await beforeRead?.(calls.length);
    const value = await original.apply(this, args);
    bytes += value.bytesRead;
    return value;
  });
  return { calls, handles, get bytes() { return bytes; }, restore: () => wrapped.mock.restore() };
}

function assertMetadataOnly(result) {
  for (const key of ['text', 'messages', 'items', 'content', 'events', 'summary', 'losses']) assert.equal(Object.hasOwn(result, key), false, `${key} must not contain history`);
  assert.equal(result.metadataSampled, true);
  assert.equal(typeof result.sizeBytes, 'number');
}

test('prepare safely locates the original project and returns no conversation, tool or thinking body', async (t) => {
  const f = await fixture(t, [
    row('assistant', 'SIDECHAIN_BODY', { cwd: '/wrong/branch', isSidechain: true }),
    row('user', 'USER_BODY_MUST_NOT_BE_RETURNED'),
    row('assistant', [
      { type: 'text', text: 'ASSISTANT_BODY_MUST_NOT_BE_RETURNED' },
      { type: 'thinking', thinking: 'PRIVATE_THINKING_MARKER' },
      { type: 'tool_use', id: 'OLD_TOOL_MARKER', name: 'TOOL_NAME_MARKER', input: { secret: 'TOOL_ARGUMENT_MARKER' } },
    ]),
    row('user', [{ type: 'tool_result', tool_use_id: 'OLD_TOOL_MARKER', content: 'TOOL_OUTPUT_MARKER' }]),
  ], { lookupCwd: '/caller/dsh-workspace' });
  const before = await readFile(f.path);
  const result = await f.service.prepareHandoff(f.request);
  assertMetadataOnly(result);
  assert.equal(result.cwd, origin);
  assert.notEqual(result.cwd, f.lookupCwd);
  assert.equal(result.id, sourceId);
  assert.equal(result.sourcePath, await realpath(f.path));
  assert.equal(result.sizeBytes, before.length);
  assert.match(result.warnings.join(' '), /recorded source project differs/);
  assert.doesNotMatch(JSON.stringify(result), /USER_BODY|ASSISTANT_BODY|SIDECHAIN_BODY|THINKING_MARKER|TOOL_(?:NAME|ARGUMENT|OUTPUT|MARKER)/);
  assert.deepEqual(await readFile(f.path), before);
});

test('directory changes remain previewable while preparation only returns the initial project metadata', async (t) => {
  const f = await fixture(t, [
    row('user', 'Initial project goal'),
    row('assistant', 'Working in a child', { cwd: `${origin}/src` }),
    row('user', 'Latest instruction', { cwd: '/another/project' }),
  ]);
  const preview = await f.service.preview(f.request);
  assert.equal(preview.cwd, origin);
  assert.match(preview.text, /Latest instruction/);
  assert.match(preview.warnings.join(' '), /changed 2 time/);
  const prepared = await f.service.prepareHandoff(f.request);
  assert.equal(prepared.cwd, origin);
  assertMetadataOnly(prepared);
});

test('missing or invalid source cwd uses the explicitly selected lookup directory', async (t) => {
  const f = await fixture(t, [
    { type: 'progress', cwd: '/wrong/branch', isSidechain: true },
    { type: 'progress', cwd: 'relative/path' },
    { type: 'progress', cwd: '/invalid\0path' },
  ]);
  const result = await f.service.prepareHandoff(f.request);
  assert.equal(result.cwd, f.lookupCwd);
  assert.match(result.warnings.join(' '), /No valid absolute source cwd/);
  assertMetadataOnly(result);
});

test('a sparse source larger than 128 MiB is located with at most 128 KiB read and no tail scan', async (t) => {
  const f = await fixture(t, [{ type: 'progress', cwd: origin }], { sessionImportMaxBytes: 1024 });
  const size = 129 * 1024 * 1024;
  const tail = '\n' + JSON.stringify({ type: 'custom-title', title: 'TAIL_SENTINEL_MUST_NOT_BE_SCANNED' }) + '\n{malformed tail\n';
  const handle = await open(f.path, 'r+');
  try { await handle.truncate(size); await handle.write(tail, size - Buffer.byteLength(tail), 'utf8'); }
  finally { await handle.close(); }
  const before = await stat(f.path);
  const reads = await observeReads(t, f.path);
  const result = await f.service.prepareHandoff({ ...f.request, limitTurns: 50 });
  reads.restore();
  assert.equal(result.sizeBytes, size);
  assert.equal(result.cwd, origin);
  assertMetadataOnly(result);
  assert.equal(reads.bytes, SAMPLE_BYTES);
  assert.ok(reads.calls.every((call) => call.position === null && call.length <= 64 * 1024));
  assert.equal(reads.calls.reduce((total, call) => total + call.length, 0), SAMPLE_BYTES);
  assert.doesNotMatch(JSON.stringify(result), /TAIL_SENTINEL|malformed/);
  const after = await stat(f.path);
  assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(after.ino, before.ino);
  const verify = await open(f.path);
  try {
    const buffer = Buffer.alloc(Buffer.byteLength(tail));
    await verify.read(buffer, 0, buffer.length, size - buffer.length);
    assert.equal(buffer.toString(), tail);
  } finally { await verify.close(); }
});

test('a source growing during metadata sampling cannot extend its read budget', async (t) => {
  const f = await fixture(t, [{ type: 'progress', cwd: origin }]);
  const reads = await observeReads(t, f.path, async (count) => {
    if (count !== 1) return;
    const grow = await open(f.path, 'r+');
    try { await grow.truncate(130 * 1024 * 1024); }
    finally { await grow.close(); }
  });
  const result = await f.service.prepareHandoff(f.request);
  assertMetadataOnly(result);
  assert.equal(reads.bytes, SAMPLE_BYTES);
  assert.ok(reads.calls.reduce((total, call) => total + call.length, 0) <= SAMPLE_BYTES);
  assert.ok([...reads.handles].every((handle) => handle.fd === -1));
});

test('limitTurns is validated without selecting or reading historical turns', async (t) => {
  const f = await fixture(t, [{ type: 'progress', cwd: origin }]);
  for (const limitTurns of [0, 10_001, 1.5, NaN, '50']) {
    await assert.rejects(f.service.prepareHandoff({ ...f.request, limitTurns }), /limitTurns/);
  }
  for (const limitTurns of [1, 10_000]) assertMetadataOnly(await f.service.prepareHandoff({ ...f.request, limitTurns }));
});

test('cached listing metadata still receives fresh safe-open validation and obeys cancellation', async (t) => {
  const f = await fixture(t, [{ type: 'progress', cwd: origin }]);
  await f.service.prepareHandoff(f.request);
  await assert.rejects(f.service.prepareHandoff(f.request, AbortSignal.abort(new Error('before read cancellation'))), /before read cancellation/);
  const controller = new AbortController();
  const reads = await observeReads(t, f.path, () => controller.abort(new Error('during metadata cancellation')));
  await assert.rejects(f.service.prepareHandoff(f.request, controller.signal), /during metadata cancellation/);
  assert.ok(reads.calls.length > 0, 'cached metadata does not bypass secure opening');
  assert.ok([...reads.handles].every((handle) => handle.fd === -1));
});

test('source paths reject traversal, relative lookup paths, symlinks and escaped project folders', async (t) => {
  const f = await fixture(t, [{ type: 'progress', cwd: origin }]);
  for (const sessionId of ['../escape', '/escape', 'a/b', 'x\0y']) await assert.rejects(f.service.prepareHandoff({ ...f.request, sessionId }), /sessionId/);
  await assert.rejects(f.service.prepareHandoff({ ...f.request, cwd: 'relative' }), /absolute/);
  await symlink(f.path, join(f.project, 'symlink-source.jsonl'));
  await assert.rejects(f.service.prepareHandoff({ ...f.request, sessionId: 'symlink-source' }), /symlink/);
  await mkdir(join(f.project, 'directory-source.jsonl'));
  await assert.rejects(f.service.prepareHandoff({ ...f.request, sessionId: 'directory-source' }), /symlink|regular/);
  const outside = join(f.root, 'outside');
  await mkdir(outside);
  const escapedCwd = '/fixture/escaped';
  await symlink(outside, claudeProjectsDir(escapedCwd, f.userClaudeDir));
  await assert.rejects(f.service.prepareHandoff({ ...f.request, cwd: escapedCwd }), /escapes/);
});
