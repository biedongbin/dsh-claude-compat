// Hook handler fields (issue #2): exec form, `if` rule, timeout, async,
// onFailure, CLAUDE_PROJECT_DIR, failure reasons. Hermetic: temp settings
// dirs and temp output files; real child processes only in the runner tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matchIfRule, parseHookHandler } from '../src/hook-spec.js';
import { registerHooks, runHookCommand } from '../src/hooks.js';

const PROJECT = '/work/project';

function parse(raw, event = 'pre-tool-use') {
  return parseHookHandler(raw, { event, projectDir: PROJECT });
}

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

const plain = (command, extra = {}) => ({ command, projectDir: '/tmp', ...extra });

// Collect console.warn output for the duration of fn.
async function withWarnings(fn) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const value = await fn(warnings);
    return { value, warnings };
  } finally {
    console.warn = original;
  }
}

async function waitFor(predicate, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return predicate();
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
  assert.deepEqual(result.notes, []);
});

test('timeout is seconds in settings and milliseconds at run time', () => {
  assert.equal(parse({ command: 'x', timeout: 2 }).handler.timeoutMs, 2000);
  assert.equal(parse({ command: 'x', timeout: 0.5 }).handler.timeoutMs, 500);
});

test('exec form expands CLAUDE_PROJECT_DIR as data, even with $& in the path', () => {
  const result = parseHookHandler(
    { command: '${CLAUDE_PROJECT_DIR}/bin/check', args: ['--root', '${CLAUDE_PROJECT_DIR}', '$HOME'] },
    { event: 'pre-tool-use', projectDir: '/w/a$&b' },
  );
  assert.equal(result.handler.command, '/w/a$&b/bin/check');
  assert.deepEqual(result.handler.args, ['--root', '/w/a$&b', '$HOME']);
});

test('shell form keeps the variable token: the shell reads it from the environment', () => {
  const result = parse({ command: 'check "${CLAUDE_PROJECT_DIR}"' });
  assert.equal(result.handler.command, 'check "${CLAUDE_PROJECT_DIR}"');
});

test('async and onFailure are read for the events where they apply', () => {
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
    [{ command: 'x', timeout: 0.0004 }, /timeout must be/],
    [{ command: 'x', timeout: 2147483.648 }, /timeout must be/],
    [{ command: 'x', timeout: NaN }, /timeout must be/],
    [{ command: 'x', timeout: '5' }, /timeout must be/],
    [{ command: 'x', onFailure: 'maybe' }, /onFailure must be/],
    [{ command: 'x', async: 'true' }, /async must be/],
    [{ command: 'x', if: 42 }, /if must be a string/],
    [{ command: 'x', if: 'Bash(git *' }, /not a tool name or Tool\(pattern\)/],
    [{ command: 'x', if: 'WebFetch(domain:x)' }, /patterns are not supported for WebFetch/],
  ];
  for (const [raw, pattern] of cases) {
    const result = parse(raw);
    assert.equal(result.ok, false, JSON.stringify(raw));
    assert.match(result.reason, pattern);
  }
});

test('the timeout bounds are checked after conversion to milliseconds', () => {
  assert.equal(parse({ command: 'x', timeout: 0.001 }).handler.timeoutMs, 1);
  assert.equal(parse({ command: 'x', timeout: 2147483.647 }).handler.timeoutMs, 2147483647);
});

test('an if rule on a session event is rejected, because such a hook never runs', () => {
  const result = parse({ command: 'x', if: 'Bash(git *)' }, 'session-start');
  assert.equal(result.ok, false);
  assert.match(result.reason, /only to tool events/);
});

test('fields that are accepted but have no effect produce notes', () => {
  assert.match(parse({ command: 'x', onFailure: 'block' }, 'session-start').notes[0], /only to tool events/);
  assert.match(parse({ command: 'x', onFailure: 'block', async: true }).notes[0], /ignored for async/);
  assert.match(parse({ command: 'x', async: true }, 'user-prompt-submit').notes[0], /foreground/);
});

test('parsing never throws on odd input, and a rejection always has a reason', () => {
  const odd = [
    undefined, null, 1, 'x', [], {}, { type: 'command' },
    { command: 'x', args: [null] }, { command: 'x', if: ['Bash'] },
    { command: 'x', timeout: {} }, { command: 'x', onFailure: null }, { command: 'x', async: null },
  ];
  for (const raw of odd) {
    for (const event of ['pre-tool-use', 'session-start', 'user-prompt-submit']) {
      const result = parse(raw, event);
      if (result.ok) assert.equal(typeof result.handler.async, 'boolean');
      else assert.ok(typeof result.reason === 'string' && result.reason !== '');
    }
  }
});

// ─── matchIfRule ─────────────────────────────────────────────────────────────

test('Bash(pattern) matches the command with a * glob, anchored at both ends', () => {
  const input = { command: 'git status' };
  assert.equal(matchIfRule('Bash(git *)', 'Bash', input), true);
  assert.equal(matchIfRule('Bash(git *)', 'Bash', { command: 'npm test' }), false);
  assert.equal(matchIfRule('Bash(git)', 'Bash', input), false);
  assert.equal(matchIfRule('Bash(git *)', 'Edit', input), false);
});

test('a compound command matches when one subcommand matches', () => {
  assert.equal(matchIfRule('Bash(git push *)', 'Bash', { command: 'cd /tmp && git push --force' }), true);
  assert.equal(matchIfRule('Bash(git push *)', 'Bash', { command: 'ls; git push' }), true);
  assert.equal(matchIfRule('Bash(git push *)', 'Bash', { command: 'echo git push' }), false);
});

test('a trailing " *" also matches the bare command when the rest has no *', () => {
  assert.equal(matchIfRule('Bash(npm run *)', 'Bash', { command: 'npm run' }), true);
  assert.equal(matchIfRule('Bash(npm run *)', 'Bash', { command: 'npm install' }), false);
  assert.equal(matchIfRule('Bash(ls *)', 'Bash', { command: 'ls' }), true);
  assert.equal(matchIfRule('Bash(ls *)', 'Bash', { command: 'lsof' }), false);
});

test('the :* suffix means the same as a trailing " *"', () => {
  assert.equal(matchIfRule('Bash(ls:*)', 'Bash', { command: 'ls -la' }), true);
  assert.equal(matchIfRule('Bash(ls:*)', 'Bash', { command: 'lsof' }), false);
});

test('a * in the middle of a pattern needs the text around it', () => {
  assert.equal(matchIfRule('Bash(* --help *)', 'Bash', { command: 'npm --help x' }), true);
  assert.equal(matchIfRule('Bash(* --help *)', 'Bash', { command: 'npm --help' }), false);
  assert.equal(matchIfRule('Bash(git log * main)', 'Bash', { command: 'git log --oneline main' }), true);
  assert.equal(matchIfRule('Bash(git log * main)', 'Bash', { command: 'git log main' }), false);
});

test('a bare tool name matches every call to that tool', () => {
  assert.equal(matchIfRule('Bash', 'Bash', { command: 'anything' }), true);
  assert.equal(matchIfRule('Bash', 'Read', { file_path: '/x' }), false);
});

test('Edit(glob) and Write(glob) match the file path', () => {
  assert.equal(matchIfRule('Edit(*.ts)', 'Edit', { file_path: 'src/a.ts' }), true);
  assert.equal(matchIfRule('Edit(*.ts)', 'Edit', { file_path: 'src/a.js' }), false);
  assert.equal(matchIfRule('Write(*.md)', 'Write', { file_path: 'README.md' }), true);
});

test('NotebookEdit matches notebook_path, the field its input uses', () => {
  assert.equal(matchIfRule('NotebookEdit(*.ipynb)', 'NotebookEdit', { notebook_path: 'a.ipynb' }), true);
  assert.equal(matchIfRule('NotebookEdit(*.ipynb)', 'NotebookEdit', { file_path: 'a.ipynb' }), false);
});

test('a pattern never matches when the input has no field for it', () => {
  assert.equal(matchIfRule('Bash(git *)', 'Bash', {}), false);
  assert.equal(matchIfRule('Bash(git *)', 'Bash', null), false);
});

test('a malformed rule never matches', () => {
  assert.equal(matchIfRule('not a rule!', 'Bash', { command: 'x' }), false);
  assert.equal(matchIfRule('', 'Bash', { command: 'x' }), false);
});

test('a literal pattern matches exactly its own text, special characters included', () => {
  const literals = ['a.b', '(a)[b]{c}', '$^+?|-', 'a b/c', 'x\\y', 'npm test'];
  for (const text of literals) {
    assert.equal(matchIfRule(`Bash(${text})`, 'Bash', { command: text }), true, text);
    assert.equal(matchIfRule(`Bash(${text})`, 'Bash', { command: `${text}!` }), false, text);
  }
});

// ─── runHookCommand ──────────────────────────────────────────────────────────

test('shell form sees CLAUDE_PROJECT_DIR as data, so shell characters in the path do not run', async () => {
  const hostile = '/tmp/p; echo pwned; $(echo pwned)';
  const run = await runHookCommand(
    plain('printf %s "$CLAUDE_PROJECT_DIR"', { projectDir: hostile }),
    '',
    {},
  );
  assert.equal(run.stdout, hostile);
  assert.equal(run.failed, false);
});

test('exec form runs the program with no shell, so $HOME stays literal', async () => {
  const run = await runHookCommand(plain('printf', { args: ['%s', '$HOME'] }), '', {});
  assert.equal(run.stdout, '$HOME');
  assert.equal(run.exitCode, 0);
});

test('stdin reaches the hook', async () => {
  const run = await runHookCommand(plain('cat'), '{"tool":"x"}', {});
  assert.equal(run.stdout, '{"tool":"x"}');
});

test('exit 2 blocks but is not a failure; any other non-zero exit is a failure with its code', async () => {
  const blocked = await runHookCommand(plain('exit 2'), '', {});
  assert.deepEqual([blocked.exitCode, blocked.failed], [2, false]);
  const broken = await runHookCommand(plain('exit 5'), '', {});
  assert.deepEqual([broken.exitCode, broken.failed, broken.reason], [5, true, 'exit 5']);
});

test('a hook that cannot start is a failure whose reason names the error code', async () => {
  const run = await runHookCommand(plain('/no/such/hook-binary', { args: [] }), '', {});
  assert.equal(run.failed, true);
  assert.match(run.reason, /failed to start: ENOENT/);
});

test('an argument Node refuses (a NUL byte) is a failed run, not an exception', async () => {
  const run = await runHookCommand(plain('printf', { args: ['a\u0000b'] }), '', {});
  assert.equal(run.failed, true);
  assert.match(run.reason, /cannot start/);
});

test('a hook past its timeout is killed with its children, and counts as a failure', async () => {
  const pidFile = join(tempDir('dcc-pid-'), 'child.pid');
  const run = await runHookCommand(plain(`sleep 30 & echo $! > "${pidFile}"; wait`), '', { timeoutMs: 500 });
  assert.equal(run.failed, true);
  assert.match(run.reason, /timed out after 500ms/);
  const childPid = Number(readFileSync(pidFile, 'utf8'));
  await waitFor(() => !isAlive(childPid), 2000);
  assert.equal(isAlive(childPid), false, 'the sleep child is gone, not only the shell');
});

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('a hook killed by a signal reports the signal', async () => {
  const run = await runHookCommand(plain('kill -9 $$'), '', {});
  assert.equal(run.failed, true);
  assert.equal(run.reason, 'killed by SIGKILL');
});

// ─── registerHooks: the listeners apply the fields ───────────────────────────

function settingsDir(hooks) {
  const dir = tempDir('dcc-hooks-');
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ hooks }));
  return dir;
}

function listenersFor(hooks) {
  const listeners = new Map();
  const ctx = { on: (name, fn) => listeners.set(name, fn) };
  registerHooks(ctx, { userClaudeDir: settingsDir(hooks), projectRootMarkers: ['.git'], hooksTimeoutMs: 5000 });
  return listeners;
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

test('onFailure block turns a failed pre-tool hook into a deny with the reason', async () => {
  const blocked = listenersFor({
    PreToolUse: [{ matcher: '.*', hooks: [{ command: 'exit 5', onFailure: 'block' }] }],
  });
  const { value, warnings } = await withWarnings(() => blocked.get('tools/pre-execute')(preCall('Read', {})));
  assert.equal(value.kind, 'deny');
  assert.match(value.reason, /exit 5/);
  assert.match(warnings[0], /PreToolUse hook failed, exit 5/);
});

test('without onFailure a failed pre-tool hook allows the call and logs the reason once', async () => {
  const allowed = listenersFor({
    PreToolUse: [{ matcher: '.*', hooks: [{ command: 'exit 5' }] }],
  });
  const { value, warnings } = await withWarnings(() => allowed.get('tools/pre-execute')(preCall('Read', {})));
  assert.equal(value.kind, 'allow');
  assert.equal(warnings.length, 1);
});

test('onFailure block turns a failed post-tool hook into a block', async () => {
  const listeners = listenersFor({
    PostToolUse: [{ matcher: '.*', hooks: [{ command: 'exit 5', onFailure: 'block' }] }],
  });
  const { value } = await withWarnings(() => listeners.get('tools/post-execute')(preCall('Read', {}), 'ok'));
  assert.equal(value.kind, 'block');
});

test('an async tool hook cannot change the decision, and its failure is logged', async () => {
  const listeners = listenersFor({
    PreToolUse: [{ matcher: '.*', hooks: [{ command: 'exit 5', async: true }] }],
  });
  const { value, warnings } = await withWarnings(async (logged) => {
    const decision = await listeners.get('tools/pre-execute')(preCall('Read', {}));
    await waitFor(() => logged.length > 0);
    return decision;
  });
  assert.equal(value.kind, 'allow');
  assert.match(warnings[0], /async hook failed, exit 5/);
});

test('post-tool contexts from several hooks all reach the decision', async () => {
  const context = (text) => `printf '%s' '{"additionalContext":"${text}"}'`;
  const listeners = listenersFor({
    PostToolUse: [{ matcher: '.*', hooks: [{ command: context('A') }, { command: context('B') }] }],
  });
  const decision = await listeners.get('tools/post-execute')(preCall('Read', {}), 'ok');
  assert.equal(decision.kind, 'accept');
  assert.equal(decision.additionalContexts.length, 2);
});

test('the hook receives Claude-shaped JSON on stdin with the event name and cwd', async () => {
  const dir = tempDir('dcc-stdin-');
  const file = join(dir, 'stdin.json');
  const listeners = listenersFor({
    PreToolUse: [{ matcher: 'Bash', hooks: [{ command: `cat > "${file}"` }] }],
  });
  await listeners.get('tools/pre-execute')(preCall('Bash', { command: 'git status' }));
  const payload = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(payload.hook_event_name, 'PreToolUse');
  assert.equal(payload.tool_name, 'Bash');
  assert.equal(payload.tool_input.command, 'git status');
  assert.equal(typeof payload.cwd, 'string');
});

test('a failed user-prompt hook is logged, and the prompt still goes through', async () => {
  const listeners = listenersFor({
    UserPromptSubmit: [{ matcher: '.*', hooks: [{ command: 'exit 5' }] }],
  });
  const { value, warnings } = await withWarnings(() => listeners.get('agent/pre-step')(
    { agent: { session: { events: {} } }, messages: [] },
    async () => ({ kind: 'enter', messages: [] }),
  ));
  assert.equal(value.kind, 'enter');
  assert.match(warnings[0], /UserPromptSubmit hook failed, exit 5/);
});

test('a non-command handler is skipped with a warning that names the file', async () => {
  const { value, warnings } = await withWarnings(async () => listenersFor({
    PreToolUse: [{ matcher: '.*', hooks: [{ type: 'http', url: 'https://example.test' }] }],
  }));
  assert.equal(value.get('tools/pre-execute'), undefined, 'no skipped hook registers a listener');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /hook skipped: handler type "http" is not supported \(.*settings\.json\)/);
});

test('an unknown hook event is warned, not silently dropped', async () => {
  const { warnings } = await withWarnings(async () => listenersFor({
    Notification: [{ matcher: '.*', hooks: [{ command: 'exit 0' }] }],
  }));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /hook event "Notification" is not supported/);
});

test('a non-string matcher skips its entry, so it cannot widen to every tool', async () => {
  const { value, warnings } = await withWarnings(async () => listenersFor({
    PreToolUse: [{ matcher: 5, hooks: [{ command: 'exit 2' }] }],
  }));
  assert.equal(value.get('tools/pre-execute'), undefined);
  assert.match(warnings[0], /matcher must be a string/);
});
