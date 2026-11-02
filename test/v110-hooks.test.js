// Hook handler fields (issue #2): exec form, `if` rule, timeout, async,
// onFailure, CLAUDE_PROJECT_DIR. Hermetic: temp settings dirs, real child
// processes only for the runner tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandProjectDir, matchIfRule, parseHookHandler } from '../src/hook-spec.js';
import { registerHooks, runHookCommand } from '../src/hooks.js';

const PROJECT = '/work/project';

function parse(raw, event = 'pre-tool-use') {
  return parseHookHandler(raw, { event, projectDir: PROJECT });
}

// ─── parseHookHandler ────────────────────────────────────────────────────────

test('a plain command handler keeps its defaults', () => {
  const result = parse({ type: 'command', command: 'echo hi' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.handler, {
    command: 'echo hi',
    args: undefined,
    ifRule: undefined,
    timeoutMs: undefined,
    async: false,
    onFailure: 'continue',
    projectDir: PROJECT,
  });
});

test('timeout is seconds in settings and milliseconds at run time', () => {
  assert.equal(parse({ command: 'x', timeout: 2 }).handler.timeoutMs, 2000);
  assert.equal(parse({ command: 'x', timeout: 0.5 }).handler.timeoutMs, 500);
});

test('exec form expands CLAUDE_PROJECT_DIR in the command and in each argument', () => {
  const result = parse({
    command: '${CLAUDE_PROJECT_DIR}/bin/check',
    args: ['--root', '${CLAUDE_PROJECT_DIR}', '$HOME'],
  });
  assert.equal(result.handler.command, `${PROJECT}/bin/check`);
  assert.deepEqual(result.handler.args, ['--root', PROJECT, '$HOME']);
});

test('async and onFailure are read for tool events only where they apply', () => {
  assert.equal(parse({ command: 'x', async: true }, 'pre-tool-use').handler.async, true);
  assert.equal(parse({ command: 'x', async: true }, 'session-start').handler.async, false);
  assert.equal(parse({ command: 'x', onFailure: 'block' }).handler.onFailure, 'block');
});

test('an unsupported handler type is reported with its type name', () => {
  for (const type of ['http', 'prompt', 'agent', 'mcp_tool']) {
    const result = parse({ type, url: 'https://example.test', prompt: 'x' });
    assert.equal(result.ok, false);
    assert.match(result.reason, new RegExp(`"${type}" is not supported`));
  }
});

test('malformed fields are rejected with a reason, not run with a guess', () => {
  const cases = [
    [null, /not an object/],
    [{}, /command is missing/],
    [{ command: '' }, /command is missing/],
    [{ command: 'x', args: 'not-a-list' }, /args must be/],
    [{ command: 'x', args: [1] }, /args must be/],
    [{ command: 'x', timeout: 0 }, /timeout must be/],
    [{ command: 'x', timeout: -3 }, /timeout must be/],
    [{ command: 'x', timeout: '5' }, /timeout must be/],
    [{ command: 'x', onFailure: 'maybe' }, /onFailure must be/],
    [{ command: 'x', if: 42 }, /if must be a string/],
  ];
  for (const [raw, pattern] of cases) {
    const result = parse(raw);
    assert.equal(result.ok, false, JSON.stringify(raw));
    assert.match(result.reason, pattern);
  }
});

test('an if rule on a session event is rejected, because such a hook never runs', () => {
  const result = parse({ command: 'x', if: 'Bash(git *)' }, 'session-start');
  assert.equal(result.ok, false);
  assert.match(result.reason, /only to tool events/);
});

test('property: any positive timeout converts to whole milliseconds', () => {
  let seed = 7;
  const next = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let run = 0; run < 200; run += 1) {
    const seconds = 0.001 + next() * 3600;
    const result = parse({ command: 'x', timeout: seconds });
    assert.equal(result.handler.timeoutMs, Math.round(seconds * 1000));
    assert.ok(Number.isInteger(result.handler.timeoutMs));
  }
});

// ─── expandProjectDir ────────────────────────────────────────────────────────

test('expandProjectDir replaces every occurrence and leaves other variables alone', () => {
  assert.equal(
    expandProjectDir('${CLAUDE_PROJECT_DIR}/a ${CLAUDE_PROJECT_DIR} $HOME ${HOME}', '/p'),
    '/p/a /p $HOME ${HOME}',
  );
});

// ─── matchIfRule ─────────────────────────────────────────────────────────────

test('Bash(pattern) matches the command with a * glob, anchored at both ends', () => {
  const input = { command: 'git status' };
  assert.equal(matchIfRule('Bash(git *)', 'Bash', input), true);
  assert.equal(matchIfRule('Bash(git *)', 'Bash', { command: 'npm test' }), false);
  assert.equal(matchIfRule('Bash(git)', 'Bash', input), false);
  assert.equal(matchIfRule('Bash(git *)', 'Edit', input), false);
});

test('a bare tool name matches every call to that tool', () => {
  assert.equal(matchIfRule('Bash', 'Bash', { command: 'anything' }), true);
  assert.equal(matchIfRule('Bash', 'Read', { file_path: '/x' }), false);
});

test('Edit(glob) matches the file path', () => {
  assert.equal(matchIfRule('Edit(*.ts)', 'Edit', { file_path: 'src/a.ts' }), true);
  assert.equal(matchIfRule('Edit(*.ts)', 'Edit', { file_path: 'src/a.js' }), false);
});

test('a pattern never matches when the input has no field for it', () => {
  assert.equal(matchIfRule('Bash(git *)', 'Bash', {}), false);
  assert.equal(matchIfRule('Bash(git *)', 'Bash', null), false);
  assert.equal(matchIfRule('Grep(foo)', 'Grep', { pattern: 'foo' }), false);
});

test('a malformed rule never matches', () => {
  assert.equal(matchIfRule('not a rule!', 'Bash', { command: 'x' }), false);
  assert.equal(matchIfRule('', 'Bash', { command: 'x' }), false);
});

test('property: a literal pattern matches exactly its own text', () => {
  let seed = 11;
  const next = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const alphabet = 'abc XYZ 019().[]{}$^+?|\\-_/';
  for (let run = 0; run < 200; run += 1) {
    const length = 1 + Math.floor(next() * 12);
    let text = '';
    for (let i = 0; i < length; i += 1) text += alphabet[Math.floor(next() * alphabet.length)];
    assert.equal(matchIfRule(`Bash(${text})`, 'Bash', { command: text }), true, text);
    assert.equal(matchIfRule(`Bash(${text})`, 'Bash', { command: `${text}!` }), false, text);
  }
});

// ─── runHookCommand ──────────────────────────────────────────────────────────

const plain = (command, extra = {}) => ({ command, projectDir: '/tmp', ...extra });

test('shell form sees CLAUDE_PROJECT_DIR and passes stdin through', async () => {
  const env = await runHookCommand(plain('printf %s "$CLAUDE_PROJECT_DIR"', { projectDir: '/tmp/proj' }), '', {});
  assert.equal(env.stdout, '/tmp/proj');
  assert.equal(env.failed, false);
  const echoed = await runHookCommand(plain('cat'), '{"tool":"x"}', {});
  assert.equal(echoed.stdout, '{"tool":"x"}');
});

test('exec form runs the program with no shell, so $HOME stays literal', async () => {
  const run = await runHookCommand(plain('printf', { args: ['%s', '$HOME'] }), '', {});
  assert.equal(run.stdout, '$HOME');
  assert.equal(run.exitCode, 0);
});

test('exit 2 blocks but is not a failure; any other non-zero exit is a failure', async () => {
  const blocked = await runHookCommand(plain('exit 2'), '', {});
  assert.deepEqual([blocked.exitCode, blocked.failed], [2, false]);
  const broken = await runHookCommand(plain('exit 5'), '', {});
  assert.deepEqual([broken.exitCode, broken.failed], [5, true]);
});

test('a hook that cannot start is a failure, not a silent allow', async () => {
  const run = await runHookCommand(plain('/no/such/hook-binary', { args: [] }), '', {});
  assert.equal(run.failed, true);
});

test('a hook past its timeout is killed and counts as a failure', async () => {
  const started = Date.now();
  const run = await runHookCommand(plain('sleep 5'), '', { timeoutMs: 200 });
  assert.equal(run.failed, true);
  assert.ok(Date.now() - started < 3000, 'killed well before the sleep ends');
});

// ─── registerHooks: the listeners apply the fields ───────────────────────────

function settingsDir(hooks) {
  const dir = mkdtempSync(join(tmpdir(), 'dcc-hooks-'));
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ hooks }));
  return dir;
}

function listenersFor(hooks) {
  const listeners = new Map();
  const ctx = { on: (name, fn) => listeners.set(name, fn) };
  registerHooks(ctx, { userClaudeDir: settingsDir(hooks), projectRootMarkers: ['.git'], hooksTimeoutMs: 5000 });
  return listeners;
}

async function captureWarnings(fn) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try { return { value: await fn(), warnings }; } finally { console.warn = original; }
}

const preCall = (name, input) => ({ name, arguments: input, callId: 1 });

test('an if rule runs the hook only for matching calls', async () => {
  const listeners = listenersFor({
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', if: 'Bash(git *)', command: 'exit 2' }] }],
  });
  const pre = listeners.get('tools/pre-execute');
  assert.equal((await pre(preCall('Bash', { command: 'git status' }))).kind, 'deny');
  assert.equal((await pre(preCall('Bash', { command: 'npm test' }))).kind, 'allow');
});

test('onFailure block turns a failed pre-tool hook into a deny', async () => {
  const blocked = listenersFor({
    PreToolUse: [{ matcher: '.*', hooks: [{ command: 'exit 5', onFailure: 'block' }] }],
  });
  assert.equal((await blocked.get('tools/pre-execute')(preCall('Read', {}))).kind, 'deny');

  const allowed = listenersFor({
    PreToolUse: [{ matcher: '.*', hooks: [{ command: 'exit 5' }] }],
  });
  const { value } = await captureWarnings(() => allowed.get('tools/pre-execute')(preCall('Read', {})));
  assert.equal(value.kind, 'allow');
});

test('onFailure block turns a failed post-tool hook into a block', async () => {
  const listeners = listenersFor({
    PostToolUse: [{ matcher: '.*', hooks: [{ command: 'exit 5', onFailure: 'block' }] }],
  });
  const decision = await listeners.get('tools/post-execute')(preCall('Read', {}), 'ok');
  assert.equal(decision.kind, 'block');
});

test('an async tool hook cannot change the decision', async () => {
  const listeners = listenersFor({
    PreToolUse: [{ matcher: '.*', hooks: [{ command: 'exit 2', async: true }] }],
  });
  const decision = await listeners.get('tools/pre-execute')(preCall('Read', {}));
  assert.equal(decision.kind, 'allow');
});

test('a non-command handler is skipped with a warning that names the file', async () => {
  const { value, warnings } = await captureWarnings(async () => listenersFor({
    PreToolUse: [{ matcher: '.*', hooks: [{ type: 'http', url: 'https://example.test' }] }],
  }));
  assert.equal(value.get('tools/pre-execute'), undefined, 'no skipped hook registers a listener');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /hook skipped in .*settings\.json: handler type "http"/);
});
