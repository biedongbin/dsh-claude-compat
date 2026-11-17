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

test('legal indented and long fences never expose code as prose', () => {
  for (const code of [
    '  ```js\nconst keep = 1;\n  ```',
    '````md\n```\nconst keep = 1;\n```\n````',
    '~~~text\n~~~not-a-closing-fence\nconst keep = 1;\n~~~',
    '   ```js\r\nconst keep = 1;\r\n   ```\r',
  ]) {
    const text = `Intro\n\n${code}\n\nOutro`;
    const segments = splitMarkdown(text);
    assert.equal(segments.filter((part) => part.code).map((part) => part.text).join(''), code);
    assert.deepEqual(segments.filter((part) => !part.code).map((part) => part.text), ['Intro\n\n', '\n\nOutro']);
    assert.equal(segments.map((part) => part.text).join(''), text);
  }
});

test('translation retains paragraph and fence boundaries when providers trim text', async (t) => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'dcc-tr-boundaries-'));
  t.after(() => rmSync(cacheDir, { recursive: true, force: true }));
  const text = ' Intro.\n\n```js\nconst keep = 1;\n```\n\nOutro.\n';
  for (const backend of ['model', 'translator']) {
    const options = backend === 'model' ? { complete: async ({ text }) => text.trim() }
      : { translator: { maxTextChars: 4000, resolve: (request) => request, translate: async ({ text }) => text.trim() } };
    const result = await translateMarkdown({ text, targetLanguage: backend, cacheDir, ...options });
    assert.equal(result.content, text);
  }
  const paragraphs = 'first\n\nsecond\n\nthird';
  const result = await translateMarkdown({ text: paragraphs, targetLanguage: 'en', cacheDir,
    translator: { maxTextChars: 8, resolve: (request) => request, translate: async ({ text }) => text.trim() } });
  assert.equal(result.content, paragraphs);
  assert.equal(result.calls, 3);
});

test('empty translation is rejected and cannot poison the cache', async (t) => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'dcc-tr-empty-'));
  t.after(() => rmSync(cacheDir, { recursive: true, force: true }));
  const options = { text: 'source text', targetLanguage: 'en', cacheDir };
  await assert.rejects(translateMarkdown({ ...options, complete: async () => '  ' }), /returned no text/);
  let calls = 0;
  const result = await translateMarkdown({ ...options, complete: async () => { calls++; return 'translated'; } });
  assert.equal(calls, 1);
  assert.equal(result.content, 'translated');
  assert.equal(result.cached, false);
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
  const offline = await translateMarkdown({ text: md, targetLanguage: lang, cacheDir });
  assert.equal(offline.content, first.content, 'cached view needs no mounted backend');
  // force re-runs the backend instead of serving the cached copy
  const forced = await translateMarkdown({ text: md, targetLanguage: lang, translator, cacheDir, force: true });
  assert.equal(forced.cached, false);
  assert.equal(forced.calls, 2);
  } finally { rmSync(cacheDir, { recursive: true, force: true }); }
});

test('translateMarkdown reports completed prose chunks and the selected backend', async (t) => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'dcc-tr-progress-'));
  t.after(() => rmSync(cacheDir, { recursive: true, force: true }));
  const progress = [];
  const translator = { maxTextChars: 3, resolve: (request) => request, translate: async ({ text }) => text.toUpperCase() };
  const options = { text: 'abcdef\n\n```js\nkeep\n```\n\nxyz', targetLanguage: 'en', translator, cacheDir,
    onProgress: (event) => progress.push(event.translationProgress) };
  const result = await translateMarkdown(options);
  assert.equal(result.calls, 3);
  assert.deepEqual(progress, [0, 1, 2, 3].map((completed) => ({ completed, total: 3, backend: 'translator' })));
  assert.ok(result.content.includes('```js\nkeep\n```'));
  progress.length = 0;
  assert.equal((await translateMarkdown(options)).cached, true);
  assert.deepEqual(progress, [{ completed: 0, total: 0, backend: 'cache' }]);
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
