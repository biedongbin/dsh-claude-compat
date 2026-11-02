// Hook handler runners (src/hook-handlers.js): command against real processes,
// http against a fake fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHandler, runHookCommand, runHttpHook } from '../src/hook-handlers.js';

const plain = (command, extra = {}) => ({ type: 'command', command, projectDir: '/tmp', ...extra });

async function waitFor(predicate, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return predicate();
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─── command ─────────────────────────────────────────────────────────────────

test('shell form sees CLAUDE_PROJECT_DIR as data, so shell characters in the path do not run', async () => {
  const hostile = '/tmp/p; echo pwned; $(echo pwned)';
  const run = await runHookCommand(plain('printf %s "$CLAUDE_PROJECT_DIR"', { projectDir: hostile }), '', {});
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
  const pidFile = join(mkdtempSync(join(tmpdir(), 'dcc-pid-')), 'child.pid');
  const run = await runHookCommand(plain(`sleep 30 & echo $! > "${pidFile}"; wait`), '', { timeoutMs: 500 });
  assert.equal(run.failed, true);
  assert.match(run.reason, /timed out after 500ms/);
  const childPid = Number(readFileSync(pidFile, 'utf8'));
  await waitFor(() => !isAlive(childPid), 2000);
  assert.equal(isAlive(childPid), false, 'the sleep child is gone, not only the shell');
});

test('a hook killed by a signal reports the signal', async () => {
  const run = await runHookCommand(plain('kill -9 $$'), '', {});
  assert.equal(run.failed, true);
  assert.equal(run.reason, 'killed by SIGKILL');
});

// ─── http ────────────────────────────────────────────────────────────────────

function fakeFetch(status, body, seen = []) {
  return async (url, init) => {
    seen.push({ url, init });
    return { status, text: async () => body };
  };
}

const httpHook = (extra = {}) => ({ type: 'http', url: 'https://example.test/hook', ...extra });

test('http posts the payload as JSON to the url', async () => {
  const seen = [];
  const run = await runHttpHook(httpHook(), '{"a":1}', { fetchImpl: fakeFetch(200, '', seen) });
  assert.equal(run.failed, false);
  assert.equal(seen[0].url, 'https://example.test/hook');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.headers['content-type'], 'application/json');
  assert.equal(seen[0].init.body, '{"a":1}');
});

test('http: a 2xx with an empty body is a success with no output', async () => {
  const run = await runHttpHook(httpHook(), '{}', { fetchImpl: fakeFetch(204, '  ') });
  assert.deepEqual([run.exitCode, run.stdout, run.failed], [0, '', false]);
});

test('http: a 2xx JSON object is returned as output, to be read like command output', async () => {
  const body = '{"decision":"block","reason":"no"}';
  const run = await runHttpHook(httpHook(), '{}', { fetchImpl: fakeFetch(200, body) });
  assert.deepEqual([run.exitCode, run.stdout, run.failed], [0, body, false]);
});

test('http: a 2xx body that is not a JSON object is a failure', async () => {
  for (const body of ['plain text', '[1]', '42', '{broken']) {
    const run = await runHttpHook(httpHook(), '{}', { fetchImpl: fakeFetch(200, body) });
    assert.equal(run.failed, true, body);
    assert.match(run.reason, /not a JSON object/);
  }
});

test('http: a non-2xx status is a failure that names the status', async () => {
  const run = await runHttpHook(httpHook(), '{}', { fetchImpl: fakeFetch(500, '{"decision":"block"}') });
  assert.deepEqual([run.failed, run.reason], [true, 'http 500']);
});

test('http: a connection error is a failure with the error code', async () => {
  const fetchImpl = async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
  const run = await runHttpHook(httpHook(), '{}', { fetchImpl });
  assert.equal(run.failed, true);
  assert.match(run.reason, /http request failed: ECONNREFUSED/);
});

test('http: a timeout is a failure that names the limit', async () => {
  const fetchImpl = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  const run = await runHttpHook(httpHook(), '{}', { timeoutMs: 50, fetchImpl });
  assert.equal(run.failed, true);
  assert.match(run.reason, /timed out after 50ms/);
});

test('http headers interpolate only the variables that allowedEnvVars lists', async () => {
  const seen = [];
  const hook = httpHook({
    headers: { Authorization: 'Bearer $TOKEN', 'X-Other': '${SECRET}-${TOKEN}', Plain: 'x' },
    allowedEnvVars: ['TOKEN'],
  });
  await runHttpHook(hook, '{}', { env: { TOKEN: 't1', SECRET: 's1' }, fetchImpl: fakeFetch(200, '', seen) });
  assert.equal(seen[0].init.headers.Authorization, 'Bearer t1');
  assert.equal(seen[0].init.headers['X-Other'], '-t1', 'an unlisted variable becomes empty');
  assert.equal(seen[0].init.headers.Plain, 'x');
});

// ─── dispatch ────────────────────────────────────────────────────────────────

test('runHandler picks the runner for the handler type', async () => {
  const run = await runHandler(plain('printf ok'), '', { timeoutMs: 5000 });
  assert.equal(run.stdout, 'ok');
});

test('runHandler uses an override runner for a type, and reports a type with no runner', async () => {
  const override = async (hook) => ({ exitCode: 0, stdout: `ran ${hook.type}`, failed: false });
  const run = await runHandler({ type: 'prompt', prompt: 'x' }, '{}', { runners: { prompt: override } });
  assert.equal(run.stdout, 'ran prompt');
  const missing = await runHandler({ type: 'prompt', prompt: 'x' }, '{}', {});
  assert.equal(missing.failed, true);
  assert.match(missing.reason, /"prompt" is not available/);
});
