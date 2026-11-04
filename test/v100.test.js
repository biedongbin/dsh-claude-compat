// v1.0.0 tests: project-root discovery without a git repo (issue #10).
// A plain directory must still resolve to itself as the project root, so its
// .claude/skills and .claude/rules are read — DSH's own skill-filesystem rule
// is "nearest ancestor containing .git; without one, the current cwd".
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { apply } from '../src/index.js';
import { findProjectRoot, findProjectRootSync } from '../src/lib.js';

const sig = () => new AbortController().signal;

function sandbox(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('no marker up the chain → cwd is the project root (sync and async agree)', async () => {
  const plain = sandbox('dcc-nogit-');
  assert.equal(findProjectRootSync(plain, ['.git']), resolve(plain));
  assert.equal(await findProjectRoot(plain, ['.git']), resolve(plain));
});

test('a marker still wins: git repo root beats the cwd', async () => {
  const repo = sandbox('dcc-git-');
  mkdirSync(join(repo, '.git'));
  const deep = join(repo, 'pkg', 'app');
  mkdirSync(deep, { recursive: true });
  assert.equal(findProjectRootSync(deep, ['.git']), resolve(repo));
  assert.equal(await findProjectRoot(deep, ['.git']), resolve(repo));
});

test('non-git project: .claude/skills loads as project-claude', async () => {
  const plain = sandbox('dcc-nogit-skills-');
  mkdirSync(join(plain, '.claude', 'skills', 'demo'), { recursive: true });
  writeFileSync(join(plain, '.claude', 'skills', 'demo', 'SKILL.md'),
    '---\nname: demo\ndescription: demo skill\n---\n# demo\n');

  let provider;
  const ctx = {
    skills: { registerProvider: (f) => { provider = f({ signal: sig(), invalidate: () => {} }); return () => {}; } },
    inject() {},
    on: () => () => {},
  };
  apply(ctx, { enablePlugins: false, userClaudeDir: sandbox('dcc-nogit-user-') });
  const demo = (await provider.list({ cwd: plain })).find((c) => c.name === 'demo');
  assert.ok(demo, 'project skill discovered without a git repo');
  assert.equal(demo.source, 'project-claude');
});
