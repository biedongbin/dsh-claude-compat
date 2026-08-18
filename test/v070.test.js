// v0.7.0 tests: cc-resume session translation (pure functions, hermetic).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeSession, buildDshEvents } from '../scripts/cc-resume.mjs';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
