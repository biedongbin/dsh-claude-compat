// v0.9.0 tests: skillAliases — surfacing Chinese (non-kebab) skill names.
//
// DSH's registry validates every skill name with
// /^[a-z0-9]+(?:-[a-z0-9]+)*$/ before a candidate is readable, so a Chinese
// name can never be reached as-is. The plugin's answer is an explicit
// name → slug mapping; these tests pin the resolution order (legal name always
// beats an alias), the description tagging, and the warn-once behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isKebabName,
  normalizeAliases,
  resolveCandidateName,
  withOriginalName,
  warnUnmapped,
  resetWarnings,
} from '../src/aliases.js';

test('isKebabName mirrors the DSH registry grammar', () => {
  for (const ok of ['a', 'san-nao', 'read-bilibili', 'skill9', 'a-b-c']) {
    assert.equal(isKebabName(ok), true, ok);
  }
  for (const bad of ['三脑', '读B站', 'San-Nao', '-x', 'x-', 'a_b', 'a b', '', undefined, null, 3]) {
    assert.equal(isKebabName(bad), false, String(bad));
  }
});

test('normalizeAliases keeps only usable string → kebab-slug pairs', () => {
  const aliases = normalizeAliases({
    '三脑': 'san-nao',
    '读B站': 'read-bilibili',
    '坏目标': 'Has-Uppercase',   // not a legal slug
    '空目标': '',
    '': 'ignored',              // empty source
    '数字': 42,                  // not a string
  });
  assert.deepEqual(aliases, { '三脑': 'san-nao', '读B站': 'read-bilibili' });
});

test('normalizeAliases tolerates missing or malformed config', () => {
  assert.deepEqual(normalizeAliases(undefined), {});
  assert.deepEqual(normalizeAliases(null), {});
  assert.deepEqual(normalizeAliases([]), {});
  assert.deepEqual(normalizeAliases('nope'), {});
});

test('a legal kebab name always wins over an alias (aliases never rename)', () => {
  const aliases = { 'morning': 'other-thing' };
  assert.deepEqual(
    resolveCandidateName(['morning', 'morning'], aliases),
    { name: 'morning', original: undefined },
  );
});

test('frontmatter name wins, then flattened dir, then alias', () => {
  const aliases = { '三脑': 'san-nao' };
  // frontmatter name is already legal
  assert.deepEqual(resolveCandidateName(['tri-brain', '三脑'], aliases), { name: 'tri-brain', original: undefined });
  // frontmatter name is rejected by DSH, flattened dir is legal
  assert.deepEqual(resolveCandidateName(['salus:ai-check', 'salus-ai-check'], {}), { name: 'salus-ai-check', original: undefined });
  // both are Chinese → alias decides, and reports which name it replaced
  assert.deepEqual(resolveCandidateName(['三脑', '三脑'], aliases), { name: 'san-nao', original: '三脑' });
  // frontmatter Chinese, directory English
  assert.deepEqual(resolveCandidateName(['三脑', 'san-nao-dir'], {}), { name: 'san-nao-dir', original: undefined });
});

test('an unmapped non-kebab name resolves to undefined (caller skips)', () => {
  assert.equal(resolveCandidateName(['读知乎', '读知乎'], { '三脑': 'san-nao' }), undefined);
  assert.equal(resolveCandidateName([undefined, ''], {}), undefined);
});

test('withOriginalName keeps the Chinese name readable in the catalog', () => {
  assert.equal(withOriginalName('三脑复核流程…', '三脑'), '三脑 — 三脑复核流程…');
  // no alias → description untouched
  assert.equal(withOriginalName('plain', undefined), 'plain');
  // idempotent: resolving twice cannot double-prefix
  const once = withOriginalName('body', '三脑');
  assert.equal(withOriginalName(once, '三脑'), once);
  // empty description stays empty
  assert.equal(withOriginalName('', '三脑'), '');
});

test('warnUnmapped warns once per file, not once per catalog collect', () => {
  resetWarnings();
  const seen = [];
  const original = console.warn;
  console.warn = (...args) => seen.push(args.join(' '));
  try {
    warnUnmapped('skill', '三脑', '/tmp/a/SKILL.md');
    warnUnmapped('skill', '三脑', '/tmp/a/SKILL.md');
    warnUnmapped('skill', '读知乎', '/tmp/b/SKILL.md');
  } finally {
    console.warn = original;
  }
  assert.equal(seen.length, 2, 'one line per distinct file');
  assert.match(seen[0], /三脑/);
  assert.match(seen[0], /skillAliases/);
  assert.match(seen[1], /读知乎/);
});
