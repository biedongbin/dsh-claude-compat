// v0.7.0 tests: cc-resume session translation (pure functions, hermetic).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeSession, buildDshEvents, writeDshSession } from '../scripts/cc-resume.mjs';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

function writeClaudeLog(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'ccr-'));
  const f = join(dir, 's.jsonl');
  writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n'));
  return f;
}

test('parseClaudeSession: user/assistant/tool pairing, sidechain skipped', () => {
  const f = writeClaudeLog([
    { type: 'user', timestamp: '2026-08-18T01:00:00Z', cwd: '/w/p', message: { role: 'user', content: 'fix the bug' } },
    { type: 'assistant', timestamp: '2026-08-18T01:00:05Z', message: { role: 'assistant', content: [
      { type: 'text', text: 'Looking.' },
      { type: 'tool_use', id: 't1', name: 'bash', input: { command: 'ls' } },
    ] } },
    { type: 'user', timestamp: '2026-08-18T01:00:06Z', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 't1', content: 'file1\nfile2' },
    ] } },
    { type: 'assistant', isSidechain: true, timestamp: '2026-08-18T01:00:07Z', message: { role: 'assistant', content: [{ type: 'text', text: 'sidechain' }] } },
    { type: 'assistant', timestamp: '2026-08-18T01:00:08Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } },
    { type: 'user', timestamp: '2026-08-18T01:01:00Z', message: { role: 'user', content: 'thanks' } },
  ]);
  const parsed = parseClaudeSession(f);
  assert.equal(parsed.cwd, '/w/p');
  assert.equal(parsed.turns.length, 4);
  assert.equal(parsed.turns[0].kind, 'user');
  assert.equal(parsed.turns[0].text, 'fix the bug');
  const asst = parsed.turns[1];
  assert.equal(asst.kind, 'assistant');
  assert.equal(asst.text, 'Looking.');
  assert.equal(asst.toolUses.length, 1);
  assert.equal(asst.toolResults.length, 1);
  assert.equal(parsed.turns[3].text, 'thanks');
});

test('buildDshEvents: balanced turns, contiguous seq, header presets', () => {
  const parsed = {
    turns: [
      { kind: 'user', text: 'hi', time: 1 },
      { kind: 'assistant', text: 'hello', toolUses: [], toolResults: [], time: 2 },
      { kind: 'user', text: 'bye', time: 3 },
    ],
    createdAt: 1,
    title: null,
  };
  const events = buildDshEvents(parsed);
  const seqs = events.filter((e) => e.seq !== undefined).map((e) => e.seq);
  assert.ok(seqs.every((s, i) => i === 0 || s === seqs[i - 1] + 1), 'seq contiguous');
  const starts = events.filter((e) => e.type === 'turn/start').length;
  const ends = events.filter((e) => e.type === 'turn/end').length;
  assert.equal(starts, ends, 'turn open/close balanced');
  assert.equal(starts, 2);
  assert.ok(events.some((e) => e.type === 'permission/preset'));
  assert.ok(events.some((e) => e.type === 'session/title'));
  assert.match(events.find((e) => e.type === 'session/title').data.title, /^cc: /);
  // assistant message carries text content block
  const asst = events.find((e) => e.type === 'assistant/message');
  assert.ok(asst.data.message.content.some((b) => b.type === 'text' && b.text === 'hello'));
});

test('buildDshEvents: tool_use + tool_result pairing with DSH field names', () => {
  const parsed = {
    turns: [
      { kind: 'user', text: 'go', time: 1 },
      { kind: 'assistant', text: '', toolUses: [{ id: 'tu9', name: 'read', input: { path: '/x' } }],
        toolResults: [{ tool_use_id: 'tu9', content: 'data' }], time: 2 },
    ],
    createdAt: 1,
  };
  const events = buildDshEvents(parsed);
  const tr = events.find((e) => e.type === 'tool/result');
  assert.ok(tr, 'tool/result present');
  const block = tr.data.message.content[0];
  assert.equal(block.type, 'tool-result');
  assert.equal(block.toolCallId, 'tu9');
  assert.deepEqual(block.content, [{ type: 'text', text: 'data' }]);
});

test('parseClaudeSession: malformed lines and empty log tolerated', () => {
  const f = writeClaudeLog(['not json at all', { type: 'unknown' }]);
  const parsed = parseClaudeSession(f);
  assert.equal(parsed.turns.length, 0);
});

// Mirrors dsh-session-persistence-jsonl assertZstdHeaderFrame: the first zstd
// frame must contain exactly one header line, events live in later frames.

test('writeDshSession: first zstd frame is exactly one header line (DSH format)', () => {
  const events = buildDshEvents({
    turns: [
      { kind: 'user', text: 'hi', time: 1 },
      { kind: 'assistant', text: 'yo', toolUses: [], toolResults: [], time: 2 },
    ],
    createdAt: 1,
    title: null,
  });
  const dir = mkdtempSync(join(tmpdir(), 'dshw-'));
  const logPath = writeDshSession(dir, 'session-cc-test', '/w/p', events);
  const buf = readFileSync(logPath);
  // Hand-parse zstd frames: magic 28 B5 2F FD, frame_content_size via descriptor.
  // Simpler: decode the full stream, verify framing by decoding prefix frames.
  // Use Node zstd streaming decode on each frame boundary found via magic scan.
  let pos = 0;
  const frames = [];
  const MAGIC = 0xfd2fb528;
  while (pos + 4 <= buf.length && buf.readUInt32LE(pos) === MAGIC) {
    let next = pos + 4;
    while (next + 4 <= buf.length && buf.readUInt32LE(next) !== MAGIC) next++;
    frames.push(buf.subarray(pos, next));
    pos = next;
  }
  assert.ok(frames.length >= 2, 'header and body are separate frames');
  const headerPlain = zstdDecompressSync(frames[0]);
  assert.equal(headerPlain.indexOf(10), headerPlain.length - 1, 'header frame ends with exactly one newline');
  assert.equal(headerPlain.toString('utf8').trim(), JSON.stringify({
    type: 'session', version: 0, id: 'session-cc-test',
    createdAt: 1, cwd: '/w/p', delegationDepth: 0, agentPreset: 'standard',
  }));
});
