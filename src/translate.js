// One-click translation for the file viewer.
//
// Rules this module keeps:
//   * It NEVER writes to the source file. Translation is a view concern only.
//   * Code is not translated: fenced blocks pass through byte-for-byte, because
//     machine translation mangles identifiers even when told to preserve
//     Markdown.
//   * Results are cached on disk, keyed by content hash + target language, so a
//     second view is instant and costs nothing. The DSH translator's own cache is
//     Session-bound; this one survives restarts and other projects.
//   * Text is split below the provider's `maxTextChars` on paragraph boundaries.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Resolved per call, never at import: a test or probe must be able to point the
// cache elsewhere. A hard-coded path meant my own verification wrote fake
// translations into the user's real cache, and the UI then served them.
export function translateCacheDir() {
  const override = process.env.DSH_CLAUDE_COMPAT_TRANSLATE_CACHE;
  return override !== undefined && override !== ''
    ? override
    : join(homedir(), '.dsh', 'cache', 'claude-compat-translations');
}

// Split Markdown into alternating prose / fenced-code segments. An unterminated
// fence is treated as code to the end so a broken file cannot leak code into the
// translator.
export function splitMarkdown(text) {
  const segments = [];
  const fence = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/gm;
  let cursor = 0;
  let match;
  let openFence;
  while ((match = fence.exec(text)) !== null) {
    const marker = match[1][0];
    if (openFence === undefined) {
      // Backtick fence info strings cannot contain backticks (CommonMark).
      if (marker === '`' && match[2].includes('`')) continue;
      if (match.index > cursor) segments.push({ code: false, text: text.slice(cursor, match.index) });
      cursor = match.index;
      openFence = { marker, length: match[1].length };
    } else if (marker === openFence.marker && match[1].length >= openFence.length && /^[\t \r]*$/.test(match[2])) {
      const end = match.index + match[0].length;
      segments.push({ code: true, text: text.slice(cursor, end) });
      cursor = end;
      openFence = undefined;
    }
  }
  if (cursor < text.length) {
    segments.push({ code: openFence !== undefined, text: text.slice(cursor) });
  }
  return segments;
}

// Break prose into chunks under `limit`, preferring paragraph boundaries and
// falling back to a hard split inside an oversized paragraph.
export function chunkProse(text, limit) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let current = '';
  for (const part of text.split(/(?<=\n\n)/)) {
    if (part.length > limit) {
      if (current !== '') { chunks.push(current); current = ''; }
      for (let i = 0; i < part.length; i += limit) chunks.push(part.slice(i, i + limit));
      continue;
    }
    if (current.length + part.length > limit) { chunks.push(current); current = ''; }
    current += part;
  }
  if (current !== '') chunks.push(current);
  return chunks;
}

export function cacheKey(text, targetLanguage) {
  return createHash('sha256').update(`${targetLanguage}\u0000${text}`).digest('hex');
}

async function readCache(dir, key) {
  try { return await readFile(join(dir, `${key}.md`), 'utf8'); } catch { return undefined; }
}

async function writeCache(dir, key, value) {
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${key}.md`), value, 'utf8');
  } catch { /* a cache write must never fail a translation the user asked for */ }
}

// Translate a whole Markdown document. Returns the translated text, whether it
// came from cache, and how many provider calls it took.
//
// Two backends, one cache and one chunking policy:
//   * `translator` — DSH's dedicated service (anonymous Bing/Google endpoints).
//   * `complete`   — a one-shot model call, used when that service is not mounted
//                    in the profile. Slower and costs tokens, but keeps the
//                    feature usable instead of failing outright.
export async function translateMarkdown({ text, targetLanguage, translator, complete, signal, cacheDir, force, onProgress = () => {} }) {
  signal?.throwIfAborted();
  const startedAt = Date.now();
  const report = (completed, total, backend) => {
    const timestamp = Date.now();
    onProgress({ phase: 'running', translationProgress: { completed, total, backend },
      text: `[${new Date(timestamp).toISOString()}] Translation ${completed}/${total} chunks · ${backend} · ${Math.floor((timestamp - startedAt) / 1000)}s elapsed` });
  };
  const useTranslator = translator !== undefined && typeof translator.resolve === 'function';
  const dir = cacheDir ?? translateCacheDir();
  const key = cacheKey(text, targetLanguage);
  // `force` re-runs the backend (the recovery path for a bad cached entry).
  if (force !== true) {
    const hit = await readCache(dir, key);
    signal?.throwIfAborted();
    if (hit !== undefined) {
      report(0, 0, 'cache');
      return { content: hit, cached: true, calls: 0, backend: 'cache' };
    }
  }

  if (!useTranslator && typeof complete !== 'function') {
    throw new Error('Translation is unavailable: this profile has no translator service and no model route.');
  }
  const limit = Number(translator?.maxTextChars) > 0 ? Number(translator.maxTextChars) : 4000;
  const chunks = splitMarkdown(text).flatMap((segment) => segment.code ? [segment]
    : chunkProse(segment.text, limit).map((chunk) => ({ code: false, text: chunk })));
  const total = chunks.filter((chunk) => !chunk.code && chunk.text.trim() !== '').length;
  const backend = useTranslator ? 'translator' : 'model';
  const pieces = [];
  let calls = 0;
  report(0, total, backend);
  for (const chunk of chunks) {
    signal?.throwIfAborted();
    if (chunk.code || chunk.text.trim() === '') { pieces.push(chunk.text); continue; }
    // Providers commonly trim output. Own the original segment separators here
    // so paragraphs and fences cannot be glued together on reassembly.
    const [, leading, prose, trailing] = chunk.text.match(/^(\s*)([\s\S]*?)(\s*)$/);
    let translated;
    if (useTranslator) {
      // resolve() validates size and language before any network call.
      const spec = translator.resolve({ text: prose, targetLanguage });
      translated = await translator.translate(spec, signal);
    } else {
      translated = await complete({ text: prose, targetLanguage, signal });
    }
    if (typeof translated !== 'string' || translated.trim() === '') {
      throw new Error('The translation provider returned no text; no result was cached.');
    }
    pieces.push(leading + translated.trim() + trailing);
    signal?.throwIfAborted();
    calls += 1;
    report(calls, total, backend);
  }
  const content = pieces.join('');
  signal?.throwIfAborted();
  await writeCache(dir, key, content);
  return { content, cached: false, calls, backend };
}

// Cheap language probe for the UI: "should I offer translation at all?"
export function looksLikeTargetLanguage(text, targetLanguage) {
  const tag = String(targetLanguage || '').toLowerCase();
  // A ratio, not a boolean: `true / length` was NaN and made every English
  // document look like it needed no translation into Chinese.
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const ratio = cjkCount / Math.max(1, text.length);
  return tag.startsWith('zh') ? ratio < 0.05 : ratio > 0.2;
}
