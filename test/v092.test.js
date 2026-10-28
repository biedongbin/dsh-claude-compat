// v0.9.2 tests: native human commands (ctx.commands, @deepseek-ai/dsh-commands)
// for the manager surface. Hermetic: no claude binary, no network — script
// handlers run against empty temp cwds, reload fires a counting invalidate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerManagerCommands } from '../src/commands.js';
import { apply } from '../src/index.js';

function fakeCommandHost() {
  const defs = new Map();
  const ctx = {
    inject(names, cb) {
      if (names.includes('commands')) cb({ commands: { register: (d) => defs.set(d.name, d) } });
    },
  };
  return { ctx, defs };
}

const sig = () => new AbortController().signal;
const agentIn = (cwd) => ({ agent: { session: { header: { cwd } } }, signal: sig() });

test('registers the five manager commands; reload fires control.invalidate()', async () => {
  const { ctx, defs } = fakeCommandHost();
  let invalidated = 0;
  registerManagerCommands(ctx, {}, () => ({ control: { invalidate: () => { invalidated += 1; } } }));
  assert.deepEqual([...defs.keys()].sort(),
    ['cc-export', 'cc-plugin', 'cc-resume', 'reload-cc-plugins', 'reload-skills']);
  for (const d of defs.values()) {
    assert.equal(typeof d.handler, 'function');
    assert.ok(d.description.length > 0);
    assert.equal(typeof d.input.hint, 'string');
  }
  const out = await defs.get('reload-cc-plugins').handler({ rawInput: '', ...agentIn('/tmp') });
  assert.equal(out.kind, 'success');
  assert.match(out.text, /Catalog cache dropped/);
  assert.equal(invalidated, 1);
  await defs.get('reload-skills').handler({ rawInput: '', ...agentIn('/tmp') });
  assert.equal(invalidated, 2, 'reload-skills is an alias sharing the invalidate path');
});

test('cc-resume command: empty input → list, pinned to the session cwd', async () => {
  const { ctx, defs } = fakeCommandHost();
  registerManagerCommands(ctx, {}, () => undefined);
  const empty = mkdtempSync(join(tmpdir(), 'dcc-cmd-resume-'));
  const out = await defs.get('cc-resume').handler({ rawInput: '', ...agentIn(empty) });
  assert.equal(out.kind, 'success');
  assert.match(out.text, /No Claude sessions found/);
  assert.ok(out.text.includes(empty), 'script output names the pinned --cwd');
});

test('cc-plugin command: no args → help text (no claude CLI needed)', async () => {
  const { ctx, defs } = fakeCommandHost();
  registerManagerCommands(ctx, {}, () => undefined);
  const out = await defs.get('cc-plugin').handler({ rawInput: '', ...agentIn('/tmp') });
  assert.equal(out.kind, 'success');
  assert.match(out.text, /Claude Code Plugin Manager/);
});

test('cc-export command: list without a project root', async () => {
  const { ctx, defs } = fakeCommandHost();
  registerManagerCommands(ctx, {}, () => undefined);
  const empty = mkdtempSync(join(tmpdir(), 'dcc-cmd-export-'));
  const out = await defs.get('cc-export').handler({ rawInput: 'list', ...agentIn(empty) });
  assert.equal(out.kind, 'success');
  assert.match(out.text, /No project root found/);
});

test('apply(): wires commands next to the provider; manager skills leave the user menu', async () => {
  let provider;
  const defs = new Map();
  const ctx = {
    skills: { registerProvider: (f) => { provider = f({ signal: sig(), invalidate: () => {} }); return () => {}; } },
    inject(names, cb) {
      if (names.includes('commands')) cb({ commands: { register: (d) => defs.set(d.name, d) } });
    },
    on: () => () => {},
  };
  apply(ctx, { enablePlugins: false });
  assert.equal(defs.size, 5, 'five commands registered through the inject guard');
  const mgr = (await provider.list({ cwd: '/tmp' })).find((c) => c.name === 'cc-plugin');
  assert.equal(mgr.invocation.userInvocable, false, 'human entry moves to the command');
  assert.equal(mgr.invocation.modelInvocable, true, 'model fallback surface stays');
});

test('cc-resume command: no args → steers an interactive pick into the agent', async () => {
  // One fake Claude project under a sandbox HOME; os.homedir() reads $HOME.
  const home = mkdtempSync(join(tmpdir(), 'dcc-home-'));
  const pickCwd = '/tmp/dcc-pick';
  const projDir = join(home, '.claude', 'projects', pickCwd.replaceAll('/', '-'));
  mkdirSync(projDir, { recursive: true });
  const sid = 'aaaabbbb-cccc-dddd-eeee-ffff00001111';
  writeFileSync(join(projDir, `${sid}.jsonl`),
    `${JSON.stringify({ type: 'user', message: { content: '帮我修登录 bug' }, timestamp: '2026-10-28T02:00:00.000Z', cwd: pickCwd })}\n`);
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const { ctx, defs } = fakeCommandHost();
    registerManagerCommands(ctx, {}, () => undefined);
    const steered = [];
    const out = await defs.get('cc-resume').handler({
      rawInput: '',
      agent: { session: { header: { cwd: pickCwd } }, steer: (m) => steered.push(m) },
      signal: sig(),
    });
    assert.equal(out.kind, 'success');
    assert.match(out.text, /Interactive pick started — 1 candidate/);
    assert.equal(steered.length, 1, 'exactly one steering message');
    const text = steered[0].content[0].text;
    assert.ok(text.includes(sid), 'full session id travels in the message');
    assert.match(text, /恢复 Claude Code 会话/, 'presentable request header, not internal mechanics');
    assert.match(text, /帮我修登录 bug/, 'session preview included');
    assert.match(text, /cc-resume skill 的 Interactive flow/, 'procedure deferred to the skill playbook');
    assert.doesNotMatch(text, /bash|node\s|ask_user_question/, 'no tool or command internals leak into the bubble');
    // explicit 'list' stays the static card path
    const listing = await defs.get('cc-resume').handler({
      rawInput: 'list', agent: { session: { header: { cwd: pickCwd } }, steer: () => {} }, signal: sig(),
    });
    assert.equal(listing.kind, 'success');
    assert.match(listing.text, /1 Claude sessions/);
  } finally {
    process.env.HOME = prevHome;
  }
});

test('apply() on a host without ctx.inject: compatibility no-op, skills still work', async () => {
  let provider;
  const ctx = {
    skills: { registerProvider: (f) => { provider = f({ signal: sig(), invalidate: () => {} }); return () => {}; } },
    on: () => () => {},
  };
  apply(ctx, { enablePlugins: false }); // must not throw
  const list = await provider.list({ cwd: '/tmp' });
  assert.ok(list.some((c) => c.name === 'cc-plugin'));
});
