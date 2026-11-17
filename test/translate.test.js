import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chunkProse,
  splitMarkdown,
  looksLikeTargetLanguage,
  cacheKey,
  translateMarkdown,
} from '../src/translate.js';

test('splitMarkdown keeps fenced code byte-for-byte', () => {
  const md = '# T\n\nprose\n\n```js\nconst a = "x";\n```\n\nend\n';
  const segments = splitMarkdown(md);
  const code = segments.filter((s) => s.code);
  assert.equal(code.length, 1);
  assert.equal(code[0].text, '```js\nconst a = "x";\n```');
  // Reassembling every segment reproduces the input exactly.
  assert.equal(segments.map((s) => s.text).join(''), md);
});

test('splitMarkdown treats an unterminated fence as code', () => {
  const segments = splitMarkdown('intro\n\n```py\nprint(1)\n');
  assert.equal(segments.at(-1).code, true);
});

test('chunkProse never exceeds the provider limit', () => {
  const long = ('word '.repeat(300) + '\n\n').repeat(5);
  const chunks = chunkProse(long, 1000);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 1000, `chunk of ${chunk.length} exceeds limit`);
  assert.equal(chunks.join(''), long);
});

test('looksLikeTargetLanguage decides whether to offer translation', () => {
  assert.equal(looksLikeTargetLanguage('Hello, this is prose in English.', 'zh-CN'), true);
  assert.equal(looksLikeTargetLanguage('这是一段中文，不需要翻译。', 'zh-CN'), false);
  assert.equal(looksLikeTargetLanguage('这是一段中文，需要译成英文。', 'en'), true);
});

test('cacheKey is stable and language-sensitive', () => {
  assert.equal(cacheKey('a', 'zh-CN'), cacheKey('a', 'zh-CN'));
  assert.notEqual(cacheKey('a', 'zh-CN'), cacheKey('a', 'en'));
});

test('translateMarkdown translates prose only, and reuses its disk cache', async () => {
  const calls = [];
  const translator = {
    maxTextChars: 4000,
    resolve: (request) => ({ ...request }),
    translate: async (spec) => { calls.push(spec.text); return `[${spec.targetLanguage}]${spec.text}`; },
  };
  const md = `Intro prose.\n\n\`\`\`js\nconst keep = 1;\n\`\`\`\n\nOutro prose.\n`;
  // A unique language tag keeps this run out of any previously cached entry.
  const lang = `zz-${Date.now()}`;
  const cacheDir = mkdtempSync(join(tmpdir(), 'dcc-tr-'));
  try {
  const first = await translateMarkdown({ text: md, targetLanguage: lang, translator, cacheDir });
  assert.equal(first.cached, false);
  assert.equal(first.calls, 2, 'two prose segments, code skipped');
  assert.ok(first.content.includes('const keep = 1;'), 'code block untouched');
  assert.ok(!calls.some((text) => text.includes('const keep = 1;')), 'code never sent to the provider');
  const second = await translateMarkdown({ text: md, targetLanguage: lang, translator, cacheDir });
  assert.equal(second.cached, true);
  assert.equal(second.calls, 0);
  assert.equal(second.content, first.content);
  // force re-runs the backend instead of serving the cached copy
  const forced = await translateMarkdown({ text: md, targetLanguage: lang, translator, cacheDir, force: true });
  assert.equal(forced.cached, false);
  assert.equal(forced.calls, 2);
  } finally { rmSync(cacheDir, { recursive: true, force: true }); }
});

test('translateMarkdown fails loudly with neither backend', async () => {
  await assert.rejects(
    () => translateMarkdown({ text: 'x', targetLanguage: 'zh-CN', translator: undefined }),
    /Translation is unavailable/,
  );
});

test('translateMarkdown falls back to a one-shot model call, still skipping code', async () => {
  const seen = [];
  const complete = async ({ text, targetLanguage }) => { seen.push(text); return `[${targetLanguage}]${text}`; };
  const md = `Prose one.\n\n\`\`\`sh\nkeep me\n\`\`\`\n\nProse two.\n`;
  const cacheDir = mkdtempSync(join(tmpdir(), 'dcc-tr-'));
  const result = await translateMarkdown({ text: md, targetLanguage: `yy-${Date.now()}`, complete, cacheDir });
  rmSync(cacheDir, { recursive: true, force: true });
  assert.equal(result.backend, 'model');
  assert.equal(result.calls, 2);
  assert.ok(result.content.includes('keep me'), 'code preserved');
  assert.ok(!seen.some((text) => text.includes('keep me')), 'code never sent to the model');
});
