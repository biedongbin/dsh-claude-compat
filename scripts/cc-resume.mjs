#!/usr/bin/env node
// cc-resume.mjs — list and import Claude Code sessions into DeepSeek Harness.
//
//   node cc-resume.mjs list   [--cwd <dir>] [--limit N]
//   node cc-resume.mjs import <sessionId> [--cwd <dir>] [--limit-turns N]
//
// "list" prints one line per Claude session found under
// ~/.claude/projects/<munged-cwd>/: id, date, message count, first-user-text
// preview, and whether it is already imported into DSH.
//
// "import" translates a Claude Code session JSONL into a DSH event-sourced
// session log (~/.dsh/sessions/<munged>/session-cc-<id>/session.jsonl.zstd)
// so `dsh --resume` / the Web GUI can open the conversation with full
// history: user messages, assistant text, tool calls and results.
//
// Translation rules:
//   Claude user message      → DSH user/message + turn + step wrapper
//   Claude assistant text    → DSH assistant/message (content block "text")
//   Claude thinking          → skipped (DSH reasoning blocks are stream chunks;
//                              reconstructed reasoning would confuse replay)
//   Claude tool_use          → DSH tool/call
//   Claude tool_result       → DSH tool/result (as a tool-sourced user message)
//   Sidechain (subagent)     → skipped; only the main thread is imported
//
// The imported session gets `delegationDepth: 0`, preset `standard`, and a
// session/title event ("cc: <first user text>") so it is recognizable in the
// DSH session list. Idempotent: importing twice reuses the same target dir
// (events are truncated and rewritten).

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { zstdFramesSync } from './zstd-compat.mjs';

// ── helpers ──────────────────────────────────────────────────────────────────

function munge(dir) {
  return dir.replaceAll('/', '-');
}

function claudeProjectDir(cwd) {
  return join(homedir(), '.claude', 'projects', munge(cwd));
}

function dshSessionsDir(cwd) {
  // DSH munges /Users/x/proj → --Users-x-proj-- (leading '-' for the empty
  // segment before the absolute path's first '/'), unlike Claude's
  // -Users-x-proj (no leading '-'). Both keep a trailing '-'.
  return join(homedir(), '.dsh', 'sessions', `-${munge(cwd)}--`);
}

function targetSessionDir(sessionId, cwd) {
  return join(dshSessionsDir(cwd), `session-cc-${sessionId}`);
}

/** Parse a Claude JSONL into ordered main-thread turns. */
export function parseClaudeSession(path) {
  const turns = [];
  let pendingAssistantBlocks = null; // blocks of the assistant message in flight
  let title = null;
  let createdAt = null;
  let cwd = null;
  let msgCount = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.cwd && !cwd) cwd = d.cwd;
    if (d.timestamp && !createdAt) createdAt = Date.parse(d.timestamp);
    if (d.type === 'custom-title' && d.title) title = d.title;
    if (d.isSidechain) continue;
    if (d.type === 'user') {
      const content = d.message?.content;
      // Tool-result-only user messages continue the pending assistant turn;
      // only a real text message closes it and starts a new turn.
      const isToolResultOnly = Array.isArray(content) && content.length > 0
        && content.every((b) => b.type === 'tool_result');
      if (isToolResultOnly) {
        for (const b of content) pendingAssistantBlocks?.toolResults.push(b);
        continue;
      }
      if (pendingAssistantBlocks) { flushAssistant(); }
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
          : '';
      if (text.trim() === '') continue;
      turns.push({ kind: 'user', text, time: Date.parse(d.timestamp) || Date.now() });
      msgCount += 1;
    } else if (d.type === 'assistant') {
      const content = d.message?.content ?? [];
      if (!Array.isArray(content)) continue;
      if (!pendingAssistantBlocks) pendingAssistantBlocks = { text: [], toolUses: [], toolResults: [], time: Date.parse(d.timestamp) || Date.now() };
      else if (pendingAssistantBlocks.toolUses.length > 0 && pendingAssistantBlocks.toolResults.length >= pendingAssistantBlocks.toolUses.length) flushAssistant(),
        pendingAssistantBlocks = { text: [], toolUses: [], toolResults: [], time: Date.parse(d.timestamp) || Date.now() };
      for (const b of content) {
        if (b.type === 'text' && b.text.trim() !== '') pendingAssistantBlocks.text.push(b.text);
        if (b.type === 'tool_use') pendingAssistantBlocks.toolUses.push(b);
      }
      msgCount += 1;
    }
  }
  flushAssistant();
  return { turns, title, createdAt, cwd, msgCount };

  function flushAssistant() {
    if (!pendingAssistantBlocks) return;
    const { text, toolUses, toolResults, time } = pendingAssistantBlocks;
    if (text.length > 0 || toolUses.length > 0) {
      turns.push({ kind: 'assistant', text: text.join('\n'), toolUses, toolResults, time });
    }
    pendingAssistantBlocks = null;
  }
}

/** Build a DSH event log (array of plain events, seq assigned) from parsed turns. */
export function buildDshEvents(parsed, { limitTurns } = {}) {
  const events = [];
  let seq = 0;
  const t0 = parsed.createdAt ?? Date.now();
  const push = (type, data, dt = 0) => {
    events.push({ type, seq, time: t0 + dt, data });
    seq += 1;
  };
  push('permission/preset', { preset: 'workspace-write' });
  push('sandbox/mode', { mode: 'workspace-write' });
  push('approval/policy', { policy: 'ask' });

  const turns = Number.isFinite(limitTurns) && limitTurns > 0 ? parsed.turns.slice(-limitTurns * 2) : parsed.turns;
  let turnNo = 0;
  let dt = 1000;
  let turnOpen = false;
  for (const t of turns) {
    if (t.kind === 'user') {
      if (turnOpen) { push('turn/end', { turn: turnNo, reason: { kind: 'completed' } }, dt); dt += 10; }
      turnNo += 1;
      turnOpen = true;
      push('turn/start', { turn: turnNo }, dt); dt += 10;
      push('step/start', { turn: turnNo, step: 1 }, dt); dt += 10;
      push('user/message', { content: [{ type: 'text', text: t.text }] }, dt); dt += 50;
      push('step/end', { turn: turnNo, step: 1 }, dt); dt += 10;
    } else {
      // Assistant reply continues the preceding user message's turn
      // (user path already emitted turn/end? no — we defer turn/end to here).
      const turn = turnNo;
      if (turn === 0) { turnNo += 1; push('turn/start', { turn }, dt); dt += 10; }
      push('step/start', { turn, step: 2 }, dt); dt += 10;
      const content = [];
      if (t.text) content.push({ type: 'text', text: t.text });
      for (const u of t.toolUses) content.push({ type: 'tool_use', id: u.id, name: u.name, input: u.input ?? {} });
      if (content.length > 0) {
        push('assistant/message', { turn, step: 2, message: { role: 'assistant', content } }, dt);
        dt += 50;
      }
      let callSeq = 0;
      for (const r of t.toolResults) {
        const callId = r.tool_use_id ?? `imported-${turn}-${callSeq}`;
        const rc = typeof r.content === 'string'
          ? [{ type: 'text', text: r.content }]
          : Array.isArray(r.content)
            ? r.content.map((b) => ({ type: 'text', text: b.type === 'text' ? b.text : JSON.stringify(b) }))
            : [{ type: 'text', text: String(r.content ?? '') }];
        push('tool/result', {
          turn, step: 2,
          message: {
            id: `imported-${callId}-${callSeq}`,
            role: 'user',
            source: { kind: 'tool', callId },
            content: [{ type: 'tool-result', toolCallId: callId, isError: Boolean(r.is_error), content: rc }],
          },
        }, dt);
        callSeq += 1;
        dt += 10;
      }
      push('step/end', { turn, step: 2 }, dt); dt += 10;
    }
  }
  if (turnOpen) { push('turn/end', { turn: turnNo, reason: { kind: 'completed' } }, dt); dt += 10; }
  // Title from first real user text.
  const firstUser = parsed.turns.find((t) => t.kind === 'user' && !t.text.startsWith('<'));
  const titleText = parsed.title ?? (firstUser ? firstUser.text.slice(0, 60) : 'claude session');
  push('session/title', { title: `cc: ${titleText}`, messageSeqs: [], source: { kind: 'user' } });
  push('session/end-seed', {});
  return events;
}

/** Write events as the DSH session log (header + events, zstd-compressed). */
export function writeDshSession(sessionDir, id, cwd, events) {
  mkdirSync(sessionDir, { recursive: true });
  const logPath = join(sessionDir, 'session.jsonl.zstd');
  rmSync(logPath, { force: true });
  const header = {
    type: 'session',
    version: 0,
    id,
    createdAt: events[0]?.time ?? Date.now(),
    cwd,
    delegationDepth: 0,
    agentPreset: 'standard',
  };
  const headerLine = JSON.stringify(header) + '\n';
  const body = events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '');
  writeFileSync(logPath, zstdFramesSync(headerLine, body));
  return logPath;
}

/** List Claude sessions for a cwd. */
export function listClaudeSessions(cwd, limit = 30) {
  const dir = claudeProjectDir(cwd);
  if (!existsSync(dir)) return [];
  const out = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => {
      const id = f.replace(/\.jsonl$/, '');
      const full = join(dir, f);
      try {
        const parsed = parseClaudeSession(full);
        const st = statSync(full);
        return {
          id,
          path: full,
          mtime: st.mtimeMs,
          createdAt: parsed.createdAt,
          messages: parsed.msgCount,
          title: parsed.title ?? (parsed.turns.find((t) => t.kind === 'user' && !t.text.startsWith('<'))?.text ?? '').slice(0, 60),
          turns: parsed.turns.length,
          imported: existsSync(targetSessionDir(id, cwd)),
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
    .slice(0, limit);
  return out;
}

// ── CLI (guarded: only when run directly, not imported for tests) ──────────

const invokedDirectly = process.argv[1]?.endsWith('cc-resume.mjs') ?? false;
if (invokedDirectly) {
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const cwd = flag('cwd') ?? process.cwd();

if (cmd === 'list') {
  const sessions = listClaudeSessions(cwd, Number(flag('limit') ?? 30));
  if (sessions.length === 0) {
    console.log(`No Claude sessions found for ${cwd} (looked in ${claudeProjectDir(cwd)})`);
    process.exit(0);
  }
  for (const s of sessions) {
    const date = s.createdAt ? new Date(s.createdAt).toISOString().slice(0, 16).replace('T', ' ') : '?';
    console.log(`${s.imported ? '*' : ' '} ${s.id}  ${date}  ${String(s.messages).padStart(4)}msg  ${s.title || '(no text)'}`);
  }
  console.log(`\nImport with: node cc-resume.mjs import <sessionId> --cwd ${cwd}`);
} else if (cmd === 'import') {
  const sessionId = rest.find((a) => !a.startsWith('--'));
  if (!sessionId) { console.error('usage: import <sessionId> [--cwd dir] [--limit-turns N]'); process.exit(2); }
  const src = join(claudeProjectDir(cwd), `${sessionId}.jsonl`);
  if (!existsSync(src)) { console.error(`not found: ${src}`); process.exit(1); }
  const parsed = parseClaudeSession(src);
  if (parsed.turns.length === 0) { console.error('session has no importable turns'); process.exit(1); }
  const events = buildDshEvents(parsed, { limitTurns: Number(flag('limit-turns')) });
  const id = `session-cc-${sessionId}`;
  const dir = targetSessionDir(sessionId, cwd);
  const logPath = writeDshSession(dir, id, cwd, events);
  console.log(`imported ${parsed.turns.length} turns (${events.length} events) → ${logPath}`);
  console.log(`session id: ${id}`);
  console.log('Open it in the DSH session list (refresh the GUI), or: dsh --profile web --resume ' + id);
} else {
  console.error('usage: cc-resume.mjs list|import [<sessionId>] [--cwd dir] [--limit N] [--limit-turns N]');
  process.exit(2);
}
}
