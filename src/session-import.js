// Native Claude history import. No CLI, model request, or source-file mutation.
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { setImmediate as yieldToHost } from 'node:timers/promises';
import { CLAUDE_COMPAT_SOURCE_KIND, claudeProjectFolder, claudeProjectsDir, resolveUserClaudeDir } from './lib.js';

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SAMPLE_BYTES = 128 * 1024;
const MAX_LINE_BYTES = 4 * 1024 * 1024;
const MAX_IMPORT_BYTES = 128 * 1024 * 1024;
const PREVIEW_CHARS = 32_000;
const MAX_CACHE = 512;
const MANIFEST_PREFIX = 'Claude Code history import manifest (archive notice, not a task):\n';

function check(signal) { signal?.throwIfAborted(); }
function bounded(value, fallback, max, name, min = 1) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
}
function cwdOf(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) throw new Error('cwd must be an absolute path');
  return value;
}
function idOf(value) {
  if (typeof value !== 'string' || !SESSION_ID.test(value)) throw new Error('sessionId must be a complete Claude session identifier');
  return value;
}
function inside(parent, child) {
  const tail = relative(parent, child);
  return tail !== '' && !tail.startsWith(`..${sep}`) && tail !== '..' && !isAbsolute(tail);
}
function stamp(value, fallback = Date.now()) {
  const time = typeof value === 'number' ? value : Date.parse(value);
  return Number.isSafeInteger(time) && time >= 0 ? time : fallback;
}
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function textOf(content) {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n') : '';
}
function titleOf(value, fallback = 'Claude conversation') {
  return (String(value ?? '').replace(/\s+/g, ' ').trim() || fallback).slice(0, 160);
}
function report() {
  return { malformedLines: 0, oversizedLines: 0, malformedLineNumbers: [], sidechainRecords: 0, unsupportedBlocks: 0, missingToolResults: 0, orphanToolResults: 0, skippedMetadata: 0, omittedTurns: 0 };
}
function warningsOf(losses) {
  const labels = {
    malformedLines: 'malformed JSONL lines skipped', oversizedLines: 'oversized JSONL lines skipped',
    sidechainRecords: 'subagent/sidechain records omitted', unsupportedBlocks: 'unsupported content blocks archived as text',
    missingToolResults: 'missing historical tool results marked unavailable', orphanToolResults: 'unmatched tool results archived as text',
    skippedMetadata: 'non-conversation metadata records omitted', omittedTurns: 'older user turns omitted by limitTurns',
  };
  return Object.entries(labels).filter(([key]) => losses[key] > 0).map(([key, label]) => `${losses[key]} ${label}`);
}

// Byte-bounded UTF-8 line reader; even one unterminated hostile line cannot grow memory without a limit.
async function scanFile(path, { signal, maxBytes = Infinity, losses = report() }, consume) {
  check(signal);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Claude source must be a regular, non-symlink file');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const decoder = new StringDecoder('utf8');
  const buffer = Buffer.alloc(64 * 1024);
  let pending = '', line = 0, bytes = 0, oversized = false, stopped = false, eof = false;
  const accept = async (raw) => {
    line += 1;
    if (oversized || Buffer.byteLength(raw) > MAX_LINE_BYTES) {
      losses.oversizedLines += 1;
      oversized = false;
      return;
    }
    if (!raw.trim()) return;
    let record;
    try { record = JSON.parse(raw); }
    catch {
      losses.malformedLines += 1;
      if (losses.malformedLineNumbers.length < 20) losses.malformedLineNumbers.push(line);
      return;
    }
    if (!plain(record)) {
      losses.malformedLines += 1;
      if (losses.malformedLineNumbers.length < 20) losses.malformedLineNumbers.push(line);
      return;
    }
    if (await consume(record, line) === false) stopped = true;
    if (line % 128 === 0) await yieldToHost();
  };
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) throw new Error('Claude source changed during opening');
    while (!stopped && bytes < maxBytes) {
      check(signal);
      const read = await handle.read(buffer, 0, Math.min(buffer.length, maxBytes - bytes), null);
      if (!read.bytesRead) { eof = true; break; }
      bytes += read.bytesRead;
      let chunk = decoder.write(buffer.subarray(0, read.bytesRead));
      let pos;
      while ((pos = chunk.indexOf('\n')) !== -1) {
        await accept(pending + chunk.slice(0, pos));
        pending = '';
        chunk = chunk.slice(pos + 1);
        if (stopped) break;
      }
      if (!stopped) {
        if (!oversized) pending += chunk;
        if (Buffer.byteLength(pending) > MAX_LINE_BYTES) { pending = ''; oversized = true; }
      }
    }
    if (eof && !stopped) {
      pending += decoder.end();
      if (pending || oversized) await accept(pending);
    }
    check(signal);
    return { bytes, truncated: stopped || !eof, info: opened };
  } finally { await handle.close(); }
}

function sourceProject(fallback) {
  let origin, previous, changes = 0, invalid = 0;
  const destinations = [];
  return {
    observe(record) {
      if (record.isSidechain || record.cwd === undefined) return;
      if (typeof record.cwd !== 'string' || !isAbsolute(record.cwd) || record.cwd.includes('\0') || record.cwd.length > 8192) { invalid += 1; return; }
      const next = resolve(record.cwd);
      origin ??= next;
      if (previous && next !== previous) {
        changes += 1;
        if (destinations.length < 6) destinations.push(next.slice(0, 256));
      }
      previous = next;
    },
    get cwd() { return origin ?? fallback; },
    get hasOrigin() { return origin !== undefined; },
    warnings() {
      return [
        ...(!origin ? ['No valid absolute source cwd was found in the scanned records; the explicitly selected source directory is used.'] : []),
        ...(origin && origin !== resolve(fallback) ? ['The recorded source project differs from the source lookup directory; the recorded original project is used.'] : []),
        ...(changes ? [`The historical working directory changed ${changes} time(s); the original source project remains authoritative. Later locations: ${destinations.join(', ')}${changes > destinations.length ? ', …' : ''}`] : []),
        ...(invalid ? [`${invalid} invalid historical cwd values omitted`] : []),
      ];
    },
  };
}

function nativeId(root, cwd, id) {
  return `session-cc2-${createHash('sha256').update(`${root}\0${cwd}\0${id}`).digest('hex').slice(0, 32)}`;
}

/** Create the Host operations shared by the native UI, commands and agent tools. */
export function createSessionImportService(ctx, config = {}) {
  const userDir = resolveUserClaudeDir(config.userClaudeDir);
  const projectsRoot = join(userDir, 'projects');
  const maxImportBytes = bounded(config.sessionImportMaxBytes, MAX_IMPORT_BYTES, MAX_IMPORT_BYTES, 'sessionImportMaxBytes');
  const cache = new Map();
  const running = new Map();
  let runtime;
  const loadRuntime = () => runtime ??= import('@deepseek-ai/dsh-session');
  const persistence = () => {
    if (!ctx.sessionPersistence) throw new Error('DSH sessionPersistence is unavailable');
    return ctx.sessionPersistence;
  };

  async function directory(cwd) {
    cwdOf(cwd);
    const path = claudeProjectsDir(cwd, userDir);
    const root = await realpath(projectsRoot);
    const actual = await realpath(path);
    if (!inside(root, actual)) throw new Error('Claude project directory escapes the configured projects root');
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Claude project directory must not be a symlink');
    return actual;
  }

  async function source(cwd, id) {
    idOf(id);
    const dir = await directory(cwd);
    const path = join(dir, `${id}.jsonl`);
    const actual = await realpath(path);
    if (!inside(dir, actual)) throw new Error('Claude source escapes its project directory');
    return path;
  }

  async function existing(cwd, id, signal) {
    const store = persistence();
    for (const candidate of [nativeId(userDir, cwd, id), `session-cc-${id}`]) {
      check(signal);
      const snapshot = await store.stat(candidate, { signal });
      if (!snapshot || snapshot.header.cwd !== cwd) continue;
      if (candidate.startsWith('session-cc-')) return { sessionId: candidate, status: 'legacy-unverified', warnings: ['Existing legacy import preserved; its import completeness has not been verified.'] };
      const handle = await store.open(candidate, 'read', { signal });
      try {
        const first = await handle.read(0, 6, { signal });
        const receipt = first.events.find((event) => event.type === 'user/message' && event.data.id === `${candidate}-import-manifest`);
        const text = receipt?.data.content?.[0]?.text;
        let manifest;
        if (typeof text === 'string' && text.startsWith(MANIFEST_PREFIX)) {
          try { manifest = JSON.parse(text.slice(MANIFEST_PREFIX.length)); } catch { /* An incomplete receipt cannot authorize reuse. */ }
        }
        if (manifest?.kind === 'dsh-claude-compat/import-v1' && Number.isSafeInteger(manifest.eventCount) && manifest.eventCount >= 6) {
          const tail = await handle.read(manifest.eventCount - 1, 1, { signal });
          if (tail.events[0]?.seq === manifest.eventCount - 1 && tail.events[0]?.type === 'session/title') return { sessionId: candidate, status: 'complete', warnings: [] };
        }
        return { sessionId: candidate, status: 'incomplete', warnings: ['An incomplete or still-running import is preserved. Wait for it to finish, or request newSnapshot to create an independent copy.'] };
      } finally { await handle.close(); }
    }
  }

  async function metadata(path, signal, fresh = false) {
    check(signal);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Claude source must not be a symlink');
    const key = `${info.dev}:${info.ino}:${info.mtimeMs}:${info.size}`;
    const cached = cache.get(path);
    if (!fresh && cached?.key === key) return cached.value;
    const losses = report();
    let title, cwd, messages = 0, createdAt;
    const sampled = await scanFile(path, { signal, maxBytes: SAMPLE_BYTES, losses }, (record) => {
      if (!cwd && !record.isSidechain && typeof record.cwd === 'string' && isAbsolute(record.cwd)
        && !record.cwd.includes('\0') && record.cwd.length <= 8192) cwd = resolve(record.cwd);
      createdAt ??= stamp(record.timestamp, info.birthtimeMs > 0 ? Math.floor(info.birthtimeMs) : Math.floor(info.mtimeMs));
      if (record.type === 'custom-title' && typeof record.title === 'string') title = titleOf(record.title);
      if (!record.isSidechain && ['user', 'assistant'].includes(record.type)) {
        messages += 1;
        if (!title && record.type === 'user') {
          const text = textOf(record.message?.content);
          if (text.trim()) title = titleOf(text);
        }
      }
    });
    const value = { cwd, title: title ?? basename(path, '.jsonl'), messages, messagesExact: !sampled.truncated, createdAt, updatedAt: Math.floor(info.mtimeMs), sizeBytes: info.size, previewTruncated: sampled.truncated, warnings: warningsOf(losses) };
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(path, { key, value });
    return value;
  }

  async function listProjects(request = {}, signal) {
    const limit = bounded(request.limit, 100, 500, 'limit');
    const offset = bounded(request.offset, 0, 100_000, 'offset', 0);
    check(signal);
    let dirs;
    try { dirs = await readdir(projectsRoot, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return { items: [], hasMore: false, offset, warnings: [] }; throw error; }
    const items = [], warnings = [];
    for (const entry of dirs) {
      check(signal);
      if (!entry.isDirectory()) continue;
      const dir = join(projectsRoot, entry.name);
      const files = (await readdir(dir, { withFileTypes: true })).filter((file) => file.isFile() && file.name.endsWith('.jsonl') && SESSION_ID.test(basename(file.name, '.jsonl')));
      let found;
      for (const file of files.slice(0, 8)) {
        const value = await metadata(join(dir, file.name), signal);
        if (value.cwd && (claudeProjectFolder(value.cwd) === entry.name || claudeProjectsDir(value.cwd, userDir) === dir)) { found = value; break; }
      }
      if (!found) { if (files.length) warnings.push(`Could not identify the cwd of Claude project ${entry.name} from its bounded samples`); continue; }
      items.push({ cwd: found.cwd, title: basename(found.cwd) || found.cwd, sessions: files.length, updatedAt: found.updatedAt });
    }
    items.sort((a, b) => b.updatedAt - a.updatedAt || a.cwd.localeCompare(b.cwd));
    const query = String(request.query ?? '').toLocaleLowerCase();
    const filtered = query ? items.filter((item) => `${item.cwd} ${item.title}`.toLocaleLowerCase().includes(query)) : items;
    return { items: filtered.slice(offset, offset + limit), hasMore: filtered.length > offset + limit, offset, total: filtered.length, warnings };
  }

  async function listSessions(request, signal) {
    const cwd = cwdOf(request?.cwd);
    const limit = bounded(request.limit, 10, 100, 'limit');
    const offset = bounded(request.offset, 0, 100_000, 'offset', 0);
    const query = String(request.query ?? '').toLocaleLowerCase();
    check(signal);
    let dir;
    try { dir = await directory(cwd); }
    catch (error) { if (error.code === 'ENOENT') return { items: [], hasMore: false, offset, total: 0, warnings: [] }; throw error; }
    const files = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl') && SESSION_ID.test(basename(entry.name, '.jsonl')));
    const candidates = [], warnings = [];
    for (const file of files) {
      const path = join(dir, file.name);
      const value = await metadata(path, signal);
      // Claude's lossy encoder may put distinct paths in the same folder.
      if (value.cwd && resolve(value.cwd) !== resolve(cwd)) continue;
      const id = basename(file.name, '.jsonl');
      if (!query || `${id} ${value.title}`.toLocaleLowerCase().includes(query)) candidates.push({ ...value, cwd, id });
    }
    candidates.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    const items = candidates.slice(offset, offset + limit);
    for (const item of items) {
      const imported = ctx.sessionPersistence ? await existing(cwd, item.id, signal) : undefined;
      if (imported) {
        item.importedSessionId = imported.sessionId;
        item.importStatus = imported.status;
        item.warnings = [...item.warnings, ...imported.warnings];
      }
    }
    return { items, hasMore: candidates.length > offset + limit, offset, total: candidates.length, queryScope: 'title-and-id', warnings };
  }

  async function preview(request, signal) {
    const cwd = cwdOf(request?.cwd), id = idOf(request?.sessionId);
    const limit = bounded(request.limit, 20, 100, 'limit');
    const path = await source(cwd, id);
    const losses = report(), items = [], project = sourceProject(cwd);
    let chars = 0, limited = false;
    const result = await scanFile(path, { signal, maxBytes: 512 * 1024, losses }, (record) => {
      project.observe(record);
      // Once text is full, continue only within the existing byte cap until
      // the original project can be identified; missing early cwd is not a mismatch.
      if (items.length >= limit || chars >= PREVIEW_CHARS) { limited = true; return project.hasOrigin ? false : undefined; }
      if (record.isSidechain || !['user', 'assistant'].includes(record.type)) return;
      const text = textOf(record.message?.content);
      if (!text) return;
      const clipped = text.slice(0, Math.min(4000, PREVIEW_CHARS - chars));
      chars += clipped.length;
      items.push({ role: record.type, text: clipped, truncated: clipped.length < text.length, time: stamp(record.timestamp) });
      if ((items.length >= limit || chars >= PREVIEW_CHARS) && project.hasOrigin) return false;
    });
    return { cwd: project.cwd, id, sourcePath: path, items, text: items.map((item) => `${item.role}: ${item.text}`).join('\n\n'), truncated: result.truncated || limited || items.some((item) => item.truncated), losses, warnings: [...warningsOf(losses), ...project.warnings()] };
  }

  async function prepareHandoff(request, signal) {
    check(signal);
    const lookupCwd = cwdOf(request?.cwd), id = idOf(request?.sessionId);
    bounded(request.limitTurns, undefined, 10_000, 'limitTurns');
    const path = await source(lookupCwd, id);
    // Revalidate the source through the bounded reader even if a listing cached it.
    const value = await metadata(path, signal, true);
    check(signal);
    return { cwd: value.cwd ?? lookupCwd, id, sourcePath: path, sizeBytes: value.sizeBytes,
      metadataSampled: true, warnings: [...value.warnings,
        ...(!value.cwd ? ['No valid absolute source cwd was found in the metadata sample; the explicitly selected source directory is used.'] : []),
        ...(value.cwd && value.cwd !== resolve(lookupCwd) ? ['The recorded source project differs from the source lookup directory; the recorded original project is used.'] : []),
      ] };
  }

  async function importSession(request, signal) {
    const cwd = cwdOf(request?.cwd), id = idOf(request?.sessionId);
    const limitTurns = bounded(request.limitTurns, undefined, 10_000, 'limitTurns');
    if (request.newSnapshot !== undefined && typeof request.newSnapshot !== 'boolean') throw new Error('newSnapshot must be a boolean');
    const path = await source(cwd, id);
    const key = nativeId(userDir, cwd, id);
    if (!request.newSnapshot) {
      const previous = running.get(key);
      if (previous) { const value = await previous; check(signal); return { ...value, imported: false }; }
    }
    const operation = (async () => {
      if (!request.newSnapshot) {
        const found = await existing(cwd, id, signal);
        if (found?.status === 'incomplete') throw new Error(`${found.sessionId}: ${found.warnings[0]}`);
        if (found) return { sessionId: found.sessionId, cwd, imported: false, existing: true, importStatus: found.status, warnings: found.warnings, losses: report() };
      }
      return performImport(path, cwd, id, key, request.newSnapshot === true, limitTurns, signal);
    })();
    // Publish the promise before the first persistence await can admit another caller.
    if (!request.newSnapshot) running.set(key, operation);
    try { return await operation; }
    finally { if (running.get(key) === operation) running.delete(key); }
  }

  async function performImport(path, cwd, id, key, newSnapshot, limitTurns, signal) {
    const size = (await stat(path)).size;
    if (size > maxImportBytes) throw new Error(`Claude session exceeds the ${maxImportBytes} byte import limit`);
    const losses = report(), groups = [];
    let group = [], title, createdAt, turns = 0;
    const scanned = await scanFile(path, { signal, losses, maxBytes: maxImportBytes + 1 }, (record) => {
      if (record.isSidechain) { losses.sidechainRecords += 1; return; }
      if (record.cwd && resolve(record.cwd) !== resolve(cwd)) throw new Error('Claude session cwd does not match the requested project');
      if (record.type === 'custom-title' && typeof record.title === 'string') title = titleOf(record.title);
      if (!['user', 'assistant'].includes(record.type) || !plain(record.message)) { losses.skippedMetadata += 1; return; }
      createdAt ??= stamp(record.timestamp);
      const content = record.message.content;
      const realUser = record.type === 'user' && !(Array.isArray(content) && content.length > 0 && content.every((part) => part?.type === 'tool_result'));
      if (realUser) {
        if (group.length) groups.push(group);
        group = [];
        turns += 1;
        if (!title && textOf(content).trim()) title = titleOf(textOf(content));
        if (limitTurns && groups.length >= limitTurns) { groups.shift(); losses.omittedTurns += 1; }
      }
      group.push(record);
    });
    if (scanned.truncated || scanned.bytes > maxImportBytes) throw new Error(`Claude session exceeds the ${maxImportBytes} byte import limit`);
    if (group.length) groups.push(group);
    const records = groups.flat();
    if (!records.length) throw new Error(`Claude session contains no importable messages (${warningsOf(losses).join('; ') || 'empty source'})`);
    check(signal);
    const module = await loadRuntime();
    if (!Number.isSafeInteger(module.SESSION_FORMAT_VERSION) || typeof module.adoptSessionEvent !== 'function') throw new Error('DSH session package does not export the current event contract');
    const targetId = newSnapshot ? `${key}-${randomUUID().slice(0, 12)}` : key;
    const header = { version: module.SESSION_FORMAT_VERSION, id: targetId, createdAt: createdAt ?? Date.now(), cwd, isSeeded: false, delegationDepth: 0 };
    if (typeof config.agentPreset === 'string' && config.agentPreset) header.agentPreset = config.agentPreset;
    const events = await buildEvents(records, targetId, titleOf(title), losses, signal);
    // DSH's own admission validates source, roles, surface markers and vocabulary before any write is taken.
    for (let i = 0; i < events.length; i += 1) {
      events[i] = module.adoptSessionEvent(events[i]);
      if (i % 128 === 0) { check(signal); await yieldToHost(); }
    }
    if (typeof module.Session?.fromRestore === 'function') module.Session.fromRestore(targetId, events, header, 0, 'detached');
    check(signal);
    let handle;
    try { handle = await persistence().create(header, { signal }); }
    catch (error) {
      if (!newSnapshot && error?.name === 'SessionAlreadyExistsError') {
        const found = await existing(cwd, id, signal);
        if (found?.status === 'incomplete') throw new Error(`${found.sessionId}: ${found.warnings[0]}`);
        if (found) return { sessionId: found.sessionId, cwd, imported: false, existing: true, importStatus: found.status, warnings: found.warnings, losses: report() };
      }
      throw error;
    }
    try {
      await handle.append(events, { signal });
      await handle.flush({ signal });
    } catch (error) {
      throw new Error(`Claude import failed for ${targetId}; an incomplete new session may remain. Existing sessions were not changed. Use newSnapshot to retry. ${error.message}`, { cause: error });
    } finally { await handle.close(); }
    return { sessionId: targetId, cwd, imported: true, title: `cc: ${titleOf(title)}`, messages: records.length, turns: turns - losses.omittedTurns, eventCount: events.length, losses, warnings: warningsOf(losses) };
  }

  return { listProjects, listSessions, preview, prepareHandoff, importSession };
}

async function buildEvents(records, sessionId, title, losses, signal) {
  const events = [], pending = new Map(), usedCalls = new Set();
  let turn = 0, step = 0, turnOpen = false, stepOpen = false, clock = stamp(records[0]?.timestamp);
  const push = (type, data, surface = false) => {
    const event = { type, seq: events.length, time: clock, data, ...(surface ? { surfaceOp: 'append' } : {}) };
    events.push(event);
    return event.seq;
  };
  const message = (role, content, source, extra = {}) => ({ id: `${sessionId}-message-${events.length}`, role, source, content, ...extra });
  const toolResult = (callId, text, isError) => push('tool/result', {
    turn, step, message: message('tool', [{ type: 'text', text }], { kind: 'tool', callId }, { toolCallId: callId, ...(isError ? { isError: true } : {}) }),
  }, true);
  const closeStep = () => {
    if (!stepOpen) return;
    for (const { callId } of pending.values()) {
      losses.missingToolResults += 1;
      toolResult(callId, 'Imported historical tool call: its result was not present in the Claude transcript. No tool was executed during import. Verify external state before retrying an operation with side effects.', true);
    }
    pending.clear();
    push('step/end', { turn, step });
    stepOpen = false;
  };
  const beginStep = () => {
    if (!turnOpen) { turn += 1; step = 0; push('turn/start', { turn }); turnOpen = true; }
    if (!stepOpen) { step += 1; push('step/start', { turn, step }); stepOpen = true; }
  };
  const endTurn = () => { closeStep(); if (turnOpen) push('turn/end', { turn, reason: { kind: 'completed' } }); turnOpen = false; };
  const archive = (part) => {
    losses.unsupportedBlocks += 1;
    if (['thinking', 'redacted_thinking'].includes(part?.type)) return `[Claude ${part.type} omitted: private reasoning is not replayed]`;
    return `[Claude ${String(part?.type ?? 'unknown')} content omitted: attachment or content type is not migrated]`;
  };
  beginStep();
  const manifestSeq = push('user/message', { ...message('user', [{ type: 'text', text: '' }], { kind: CLAUDE_COMPAT_SOURCE_KIND }), id: `${sessionId}-import-manifest` }, true);
  endTurn();
  // Claude stores separate content blocks of one response as repeated assistant records.
  const combined = [];
  for (const [index, record] of records.entries()) {
    const previous = combined.at(-1);
    const content = typeof record.message.content === 'string' ? [{ type: 'text', text: record.message.content }] : record.message.content;
    if (record.type === 'assistant' && previous?.type === 'assistant' && record.message.id === previous.message.id && Array.isArray(content) && Array.isArray(previous.message.content)) {
      for (const part of content) previous.message.content.push(part);
    } else combined.push({ ...record, message: { ...record.message, content: Array.isArray(content) ? [...content] : content } });
    if (index % 128 === 0) { check(signal); await yieldToHost(); }
  }
  for (const [index, record] of combined.entries()) {
    check(signal);
    clock = stamp(record.timestamp, clock);
    const content = typeof record.message.content === 'string' ? [{ type: 'text', text: record.message.content }] : record.message.content;
    if (!Array.isArray(content)) { losses.unsupportedBlocks += 1; continue; }
    if (record.type === 'user') {
      const results = content.filter((part) => part?.type === 'tool_result');
      for (const result of results) {
        beginStep();
        const call = pending.get(result.tool_use_id);
        const parts = typeof result.content === 'string' ? [{ type: 'text', text: result.content }] : Array.isArray(result.content) ? result.content : [];
        const text = parts.map((part) => part?.type === 'text' && typeof part.text === 'string' ? part.text : archive(part)).join('\n');
        if (call) { toolResult(call.callId, text, Boolean(result.is_error)); pending.delete(result.tool_use_id); }
        else {
          losses.orphanToolResults += 1;
          push('user/message', message('user', [{ type: 'text', text: `[Archived unmatched Claude tool result ${String(result.tool_use_id ?? 'unknown')}]\n${text}` }], { kind: CLAUDE_COMPAT_SOURCE_KIND }), true);
        }
        if (!pending.size) closeStep();
      }
      const parts = content.filter((part) => part?.type !== 'tool_result');
      if (parts.length) {
        endTurn(); beginStep();
        const converted = parts.map((part) => part?.type === 'text' && typeof part.text === 'string' ? { type: 'text', text: part.text } : { type: 'text', text: archive(part) });
        push('user/message', message('user', converted, { kind: 'user' }), true);
        closeStep();
      }
    } else {
      closeStep(); beginStep();
      const converted = [], calls = [];
      for (const part of content) {
        if (part?.type === 'text' && typeof part.text === 'string') converted.push({ type: 'text', text: part.text });
        else if (part?.type === 'tool_use' && typeof part.id === 'string' && part.id && typeof part.name === 'string' && part.name) {
          if (calls.some((call) => call.originalId === part.id)) { converted.push({ type: 'text', text: archive({ type: 'duplicate tool call' }) }); continue; }
          let callId = part.id;
          if (usedCalls.has(callId)) { callId = `${sessionId}-call-${events.length}-${calls.length}`; losses.unsupportedBlocks += 1; }
          usedCalls.add(callId);
          const args = JSON.stringify(part.input ?? {});
          converted.push({ type: 'tool-call', id: callId, name: part.name, arguments: args });
          calls.push({ originalId: part.id, callId, name: part.name, arguments: args });
        } else converted.push({ type: 'text', text: archive(part) });
      }
      if (converted.length) push('assistant/message', {
        turn, step, message: message('assistant', converted, { kind: 'model', provider: 'anthropic', model: typeof record.message.model === 'string' ? record.message.model : 'unknown-imported-model' }), stream: [],
      }, true);
      for (const call of calls) {
        push('tool/call', { turn, step, callId: call.callId, name: call.name, arguments: call.arguments });
        pending.set(call.originalId, call);
      }
      if (!pending.size) closeStep();
    }
    if (index % 128 === 0) await yieldToHost();
  }
  endTurn();
  const warnings = warningsOf(losses);
  if (warnings.length) {
    beginStep();
    push('user/message', message('user', [{ type: 'text', text: `Claude Code history import report. This is an archive notice, not a new task.\n${warnings.join('\n')}\nHistorical tools were not executed. Claude runtime state, subagents and attachment bytes are not restored.` }], { kind: CLAUDE_COMPAT_SOURCE_KIND }), true);
    endTurn();
  }
  push('session/title', { title: `cc: ${title}`, messageSeqs: [], source: { kind: 'user' } });
  events[manifestSeq].data.content[0].text = MANIFEST_PREFIX + JSON.stringify({ kind: 'dsh-claude-compat/import-v1', eventCount: events.length });
  return events;
}
